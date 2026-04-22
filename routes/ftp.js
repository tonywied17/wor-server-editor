const { Router } = require('zero-http');
const FTPClient = require('molex-ftp');

const router = Router();

/** Create a configured FTP client. */
function createClient(label, host) {
  const client = new FTPClient({
    debug: true,
    logger: (msg, ...args) => console.log(`[FTP ${label} ${host}]`, msg, ...args),
  });
  client.on('error', (err) => console.error(`[FTP ${label} ${host}]`, err.message));
  return client;
}

/**
 * POST /api/ftp/download
 * Download a file from the remote FTP server.
 */
router.post('/download', async (req, res) => {
  const { host, port, username, password, remotePath } = req.body;
  if (!host || !username || !password) return res.status(400).json({ error: 'Missing host, username, or password' });

  const client = createClient('Download', host);
  try {
    await client.connect({ host, port: port || 21, user: username, password, timeout: 10000 });
    const target = remotePath || '/Assets/privileges.xml';
    const buffer = await client.download(target);
    res.json({ ok: true, content: buffer.toString('utf8') });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
});

/**
 * POST /api/ftp/upload
 * Upload content to the remote FTP server.
 */
router.post('/upload', async (req, res) => {
  const { host, port, username, password, content, remotePath } = req.body;
  if (!host || !username || !password || !content) return res.status(400).json({ error: 'Missing required parameters' });

  const client = createClient('Upload', host);
  try {
    await client.connect({ host, port: port || 21, user: username, password, timeout: 10000 });
    const target = remotePath || '/Assets/privileges.xml';
    await client.upload(content, target, true);
    res.json({ ok: true, uploadedTo: target });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
});

/**
 * POST /api/ftp/check
 * Test FTP connection and check if remote file exists.
 */
router.post('/check', async (req, res) => {
  const { host, port, username, password, remotePath } = req.body;
  if (!host || !username || !password) return res.status(400).json({ error: 'Missing required parameters' });

  const client = createClient('Check', host);
  try {
    await client.connect({ host, port: port || 21, user: username, password, timeout: 10000 });
    const target = remotePath || '/Assets/privileges.xml';
    const info = await client.stat(target);
    res.json({ exists: info.exists, size: info.size });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
});

/** Safely collect MDTM for a list of absolute paths, ignoring failures. */
async function resolveModifiedTimes(client, absolutePaths) {
  const results = new Map();
  for (const p of absolutePaths) {
    try {
      const d = await client.modifiedTime(p);
      results.set(p, d instanceof Date ? d.toISOString() : String(d));
    } catch {
      results.set(p, null);
    }
  }
  return results;
}

/** Parse a LIST-style date like "Jun 22 2024" or "Jun 22 18:05" into an ISO string. */
function parseListDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();

  // Case A: date contains an explicit 4-digit year (e.g. "Jun 22 2024", "2024-06-22 18:05").
  // Trust Date.parse only here — V8 happily parses bare "Feb 7 20:05" as year 2001,
  // which we do NOT want.
  if (/\b\d{4}\b/.test(trimmed)) {
    const t = Date.parse(trimmed);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }

  // Case B: "Mon DD HH:MM" — Unix LIST omits the year when the file is from the
  // current year (or within the last 6 months, depending on server). Anchor to
  // the current year, then roll back one year if the resulting date is in the future.
  const m = trimmed.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    const [, mon, day, hh, mm] = m;
    const now = new Date();
    const candidate = new Date(`${mon} ${day} ${now.getFullYear()} ${hh}:${mm}`);
    if (Number.isFinite(candidate.getTime())) {
      if (candidate.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
        candidate.setFullYear(now.getFullYear() - 1);
      }
      return candidate.toISOString();
    }
  }

  // Case C: "DD-Mon-YY" (some FTP servers / WinSCP-style) — 2-digit year.
  const m2 = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (m2) {
    const [, day, mon, yy] = m2;
    // Window: treat 00-79 as 2000-2079, 80-99 as 1980-1999.
    const year = Number(yy) < 80 ? 2000 + Number(yy) : 1900 + Number(yy);
    const candidate = new Date(`${mon} ${day} ${year}`);
    if (Number.isFinite(candidate.getTime())) return candidate.toISOString();
  }

  return null;
}

/**
 * Parse size + date directly out of a raw Unix LIST line.
 * Example line: "-rw-r--r--   1 user grp    12345 Apr 22 15:30 server(157).log"
 * molex-ftp sometimes can't parse these (parentheses in name) and returns
 * { type: 'unknown', size: 0, date: null } — so we parse the raw ourselves.
 */
function parseRawListLine(raw) {
  if (typeof raw !== 'string') return null;
  const line = raw.trim();
  // perms links owner group SIZE Mon DD YEAR|HH:MM name...
  const m = line.match(/^[-dl][-rwxSstT]{9,}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+([A-Za-z]{3}\s+\d{1,2}\s+(?:\d{4}|\d{1,2}:\d{2}))\s+(.+)$/);
  if (!m) return null;
  return {
    size: Number(m[1]),
    date: m[2],
    name: m[3],
  };
}

/**
 * POST /api/ftp/list-logs
 * List latest server*.log files in the FTP root (excluding 0-byte).
 * Optional body: { limit, resolveMeta }
 *   - limit: cap the number of returned entries (newest-first). Defaults to all.
 *   - resolveMeta: if true, fall back to SIZE/MDTM round-trips for entries
 *     whose size or date couldn't be derived from the LIST response.
 *     Defaults to false (fast path — trusts the LIST output).
 */
router.post('/list-logs', async (req, res) => {
  const { host, port, username, password, dir, limit, resolveMeta } = req.body;
  if (!host || !username || !password) return res.status(400).json({ error: 'Missing host, username, or password' });

  const client = createClient('ListLogs', host);
  try {
    await client.connect({ host, port: port || 21, user: username, password, timeout: 10000 });
    const baseDir = dir || '/';

    // Single LIST gets us every server*.log with size + date in one round trip.
    // G-Portal (pure-ftpd) may return type:'unknown' when a filename contains
    // parens; for those rows we parse the raw LIST line ourselves instead of
    // issuing SIZE/MDTM per file (which is what made this endpoint slow).
    const listing = await client.listDetailed(baseDir);

    const preliminary = [];
    for (const item of listing) {
      if (!item || typeof item.name !== 'string') continue;
      let name = item.name;
      let size = Number(item.size);
      let rawDate = item.date || null;

      if (!Number.isFinite(size) || size <= 0 || !rawDate) {
        const parsed = parseRawListLine(item.raw);
        if (parsed) {
          if (!Number.isFinite(size) || size <= 0) size = parsed.size;
          if (!rawDate) rawDate = parsed.date;
          if (!name) name = parsed.name;
        }
      }

      if (!/^server.*\.log$/i.test(name)) continue;
      if (item.type === 'directory' || item.type === 'symlink') continue;
      if (!Number.isFinite(size) || size <= 0) continue;

      const absPath = `${baseDir.replace(/\/+$/, '')}/${name}`.replace(/\/+/g, '/');
      preliminary.push({
        name,
        path: absPath,
        size,
        modifiedAt: parseListDate(rawDate),
        rawDate,
      });
    }

    preliminary.sort((a, b) => {
      const aT = a.modifiedAt ? Date.parse(a.modifiedAt) : 0;
      const bT = b.modifiedAt ? Date.parse(b.modifiedAt) : 0;
      return bT - aT;
    });

    const capped = Number.isFinite(Number(limit)) && Number(limit) > 0
      ? preliminary.slice(0, Number(limit))
      : preliminary;

    // Optional slow-path fallback: only for entries whose date we couldn't
    // parse from the LIST line. We do it AFTER the slice so we never pay
    // the MDTM cost for files the client won't see.
    if (resolveMeta) {
      for (const entry of capped) {
        if (!entry.modifiedAt) {
          try {
            const d = await client.modifiedTime(entry.path);
            entry.modifiedAt = d instanceof Date ? d.toISOString() : String(d);
          } catch { /* ignore */ }
        }
      }
      capped.sort((a, b) => {
        const aT = a.modifiedAt ? Date.parse(a.modifiedAt) : 0;
        const bT = b.modifiedAt ? Date.parse(b.modifiedAt) : 0;
        return bT - aT;
      });
    }

    res.json({ ok: true, entries: capped, totalMatched: preliminary.length });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
});

/** Recursively walk an FTP directory collecting files matching a predicate. */
async function walkFtpDir(client, dir, predicate, maxDepth = 6) {
  if (maxDepth < 0) return [];
  let listing = [];
  try {
    listing = await client.listDetailed(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const item of listing) {
    if (!item || !item.name || item.name === '.' || item.name === '..') continue;
    const full = `${dir.replace(/\/+$/, '')}/${item.name}`.replace(/\/+/g, '/');

    // Detect directory/file when the parser returned 'unknown'. Most FTP daemons
    // still emit a leading 'd' or '-' in the raw line even when the full regex doesn't match.
    let kind = item.type;
    if (kind === 'unknown' && typeof item.raw === 'string') {
      const first = item.raw.trim().charAt(0);
      if (first === 'd') kind = 'directory';
      else if (first === '-' || first === 'l') kind = 'file';
    }

    if (kind === 'directory') {
      const nested = await walkFtpDir(client, full, predicate, maxDepth - 1);
      out.push(...nested);
      continue;
    }
    if (kind === 'symlink') continue;
    if (!predicate(item)) continue;

    // Size + date from listing (fall back to parsing the raw line ourselves
    // when molex-ftp's parser produced type:'unknown' with 0/null).
    let size = Number(item.size);
    let rawDate = item.date || null;
    if (!Number.isFinite(size) || size <= 0 || !rawDate) {
      const parsed = parseRawListLine(item.raw);
      if (parsed) {
        if (!Number.isFinite(size) || size <= 0) size = parsed.size;
        if (!rawDate) rawDate = parsed.date;
      }
    }
    // Last-ditch size probe.
    if (!Number.isFinite(size) || size < 0) {
      try { size = await client.size(full); } catch { size = 0; }
    }
    out.push({
      name: item.name,
      path: full,
      size: Number.isFinite(size) ? size : 0,
      raw: item.raw,
      rawDate,
    });
  }
  return out;
}

/**
 * POST /api/ftp/list-crashes
 * List .dmp and .log files recursively under /Diagnostics (or custom dir).
 */
router.post('/list-crashes', async (req, res) => {
  const { host, port, username, password, dir } = req.body;
  if (!host || !username || !password) return res.status(400).json({ error: 'Missing host, username, or password' });

  const client = createClient('ListCrashes', host);
  try {
    await client.connect({ host, port: port || 21, user: username, password, timeout: 15000 });
    const baseDir = dir || '/Diagnostics';
    const files = await walkFtpDir(
      client,
      baseDir,
      (item) => /\.(dmp|log)$/i.test(item.name || ''),
    );

    // Crash dumps are typically a small list (<50 entries). LIST lines for files
    // older than ~6 months omit the time-of-day (so everything lands at 00:00),
    // and some servers emit formats our parser can't handle. Prefer MDTM for
    // accuracy here, with parseListDate as a fallback.
    const mtimes = await resolveModifiedTimes(client, files.map((f) => f.path));
    const entries = files.map((f) => ({
      name: f.name,
      path: f.path,
      size: f.size,
      modifiedAt: mtimes.get(f.path) || parseListDate(f.rawDate),
    }));

    entries.sort((a, b) => {
      const aT = a.modifiedAt ? Date.parse(a.modifiedAt) : 0;
      const bT = b.modifiedAt ? Date.parse(b.modifiedAt) : 0;
      return bT - aT;
    });
    res.json({ ok: true, entries, baseDir });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
});

/**
 * POST /api/ftp/download-binary
 * Download a file from the remote FTP server and return base64 payload.
 */
router.post('/download-binary', async (req, res) => {
  const { host, port, username, password, remotePath } = req.body;
  if (!host || !username || !password || !remotePath) {
    return res.status(400).json({ error: 'Missing host, username, password, or remotePath' });
  }

  const client = createClient('DownloadBinary', host);
  try {
    await client.connect({ host, port: port || 21, user: username, password, timeout: 20000 });

    // Use downloadStream so we can assemble the buffer from chunks ourselves —
    // molex-ftp's bare download() has been observed to resolve with 0 bytes on
    // some pure-ftpd installs when the control-channel 226 races the data-socket
    // close. Streaming sidesteps that.
    const { Writable } = require('stream');
    const chunks = [];
    const sink = new Writable({
      write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
    });
    const streamed = await client.downloadStream(remotePath, sink);
    const buffer = Buffer.concat(chunks);

    if (buffer.length === 0) {
      // Fall back once — some servers need a second RETR after a 0-byte first try.
      try {
        const retry = await client.download(remotePath);
        if (retry && retry.length > 0) {
          return res.json({ ok: true, base64: retry.toString('base64'), size: retry.length });
        }
      } catch { /* ignore */ }
      return res.status(502).json({ error: `Downloaded 0 bytes from ${remotePath} (reported ${streamed} streamed).` });
    }

    res.json({ ok: true, base64: buffer.toString('base64'), size: buffer.length });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
});

/**
 * POST /api/ftp/delete
 * Delete a remote file.
 */
router.post('/delete', async (req, res) => {
  const { host, port, username, password, remotePath } = req.body;
  if (!host || !username || !password || !remotePath) {
    return res.status(400).json({ error: 'Missing host, username, password, or remotePath' });
  }

  const client = createClient('Delete', host);
  try {
    await client.connect({ host, port: port || 21, user: username, password, timeout: 10000 });
    await client.delete(remotePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
});

module.exports = router;
