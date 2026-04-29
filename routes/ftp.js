const { Router } = require('@zero-server/core');

const {
  createTransferClient,
  PathNotFoundError,
} = require('@zero-transfer/core');
const { createFtpProviderFactory } = require('@zero-transfer/ftp');

const router = Router();

/**
 * Single shared transfer client. The FTP factory only registers a provider —
 * no sockets are opened until `client.connect(profile)` is called per request.
 * We bypass `downloadFile`/`uploadFile` entirely (and therefore the local
 * provider) so each HTTP request reuses ONE FTP control connection for every
 * stat/list/RETR/STOR it issues, instead of opening a fresh connection per
 * helper call.
 */
const ftpClient = createTransferClient({
  providers: [createFtpProviderFactory()],
});

/** Build a `ConnectionProfile` from the request body. */
function buildProfile({ host, port, username, password, timeoutMs }) {
  return {
    provider: 'ftp',
    host,
    port: port || 21,
    username,
    password,
    timeoutMs: timeoutMs || 10000,
  };
}

/**
 * Connect, run an operation against the session, and always disconnect.
 * Centralizes the connect/disconnect boilerplate every route used to repeat
 * by hand.
 */
async function withSession(profile, fn) {
  const session = await ftpClient.connect(profile);
  try {
    return await fn(session);
  } finally {
    try { await session.disconnect(); } catch { /* ignore cleanup noise */ }
  }
}

/**
 * Minimal `TransferExecutionContext` shim required by `session.transfers.read`/
 * `session.transfers.write`. The classic FTP provider only consults
 * `endpoint.path`, `range`, `throwIfAborted`, and (on writes) `reportProgress`.
 */
function makeTransferRequest(remotePath, extras = {}) {
  return {
    endpoint: { path: remotePath },
    job: { id: `pe:${remotePath}`, operation: 'transfer' },
    attempt: 1,
    throwIfAborted: () => {},
    reportProgress: () => null,
    ...extras,
  };
}

/** Drain a remote file into an in-memory Buffer over the existing session. */
async function readToBuffer(session, remotePath) {
  const result = await session.transfers.read(makeTransferRequest(remotePath));
  const chunks = [];
  for await (const chunk of result.content) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Upload an in-memory Buffer/string to a remote path over the existing session. */
async function writeFromBuffer(session, remotePath, content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  const request = makeTransferRequest(remotePath, {
    content: (async function* () { yield buffer; })(),
    totalBytes: buffer.length,
  });
  await session.transfers.write(request);
}

/** Validate the credentials common to every endpoint. */
function requireCreds(req, res) {
  const { host, username, password } = req.body;
  if (!host || !username || !password) {
    res.status(400).json({ error: 'Missing host, username, or password' });
    return false;
  }
  return true;
}

/**
 * POST /api/ftp/download
 * Download a file from the remote FTP server as UTF-8 text.
 */
router.post('/download', async (req, res) => {
  if (!requireCreds(req, res)) return;
  const profile = buildProfile(req.body);
  const target = req.body.remotePath || '/Assets/privileges.xml';
  try {
    const buffer = await withSession(profile, (session) => readToBuffer(session, target));
    res.json({ ok: true, content: buffer.toString('utf8') });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * POST /api/ftp/upload
 * Upload content to the remote FTP server.
 */
router.post('/upload', async (req, res) => {
  if (!requireCreds(req, res)) return;
  if (!req.body.content) return res.status(400).json({ error: 'Missing required parameters' });
  const profile = buildProfile(req.body);
  const target = req.body.remotePath || '/Assets/privileges.xml';
  try {
    await withSession(profile, (session) => writeFromBuffer(session, target, req.body.content));
    res.json({ ok: true, uploadedTo: target });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * POST /api/ftp/check
 * Test FTP connection and check if remote file exists.
 */
router.post('/check', async (req, res) => {
  if (!requireCreds(req, res)) return;
  const profile = buildProfile(req.body);
  const target = req.body.remotePath || '/Assets/privileges.xml';
  try {
    const result = await withSession(profile, async (session) => {
      try {
        const info = await session.fs.stat(target);
        return { exists: true, size: info.size ?? 0 };
      } catch (err) {
        if (err instanceof PathNotFoundError) return { exists: false, size: 0 };
        throw err;
      }
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * POST /api/ftp/list-logs
 * List `server*.log` files (excluding 0-byte) in the FTP root.
 * Optional body: { dir, limit, resolveMeta }
 *   - resolveMeta: per-entry MDTM fallback for entries whose `modifiedAt`
 *     wasn't included in the listing. Defaults to false.
 */
router.post('/list-logs', async (req, res) => {
  if (!requireCreds(req, res)) return;
  const profile = buildProfile(req.body);
  const baseDir = req.body.dir || '/';
  const { limit, resolveMeta } = req.body;

  try {
    const entries = await withSession(profile, async (session) => {
      const listing = await session.fs.list(baseDir);
      const matched = listing
        .filter((item) => item && typeof item.name === 'string')
        .filter((item) => item.type !== 'directory' && item.type !== 'symlink')
        .filter((item) => /^server.*\.log$/i.test(item.name))
        .filter((item) => Number.isFinite(item.size) && item.size > 0)
        .map((item) => ({
          name: item.name,
          path: item.path,
          size: item.size,
          modifiedAt: item.modifiedAt ? item.modifiedAt.toISOString() : null,
        }));

      matched.sort((a, b) => {
        const aT = a.modifiedAt ? Date.parse(a.modifiedAt) : 0;
        const bT = b.modifiedAt ? Date.parse(b.modifiedAt) : 0;
        return bT - aT;
      });

      const capped = Number.isFinite(Number(limit)) && Number(limit) > 0
        ? matched.slice(0, Number(limit))
        : matched;

      if (resolveMeta) {
        for (const entry of capped) {
          if (entry.modifiedAt) continue;
          try {
            const stat = await session.fs.stat(entry.path);
            if (stat.modifiedAt) entry.modifiedAt = stat.modifiedAt.toISOString();
          } catch { /* ignore */ }
        }
        capped.sort((a, b) => {
          const aT = a.modifiedAt ? Date.parse(a.modifiedAt) : 0;
          const bT = b.modifiedAt ? Date.parse(b.modifiedAt) : 0;
          return bT - aT;
        });
      }

      return { entries: capped, totalMatched: matched.length };
    });

    res.json({ ok: true, ...entries });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/** Recursively walk a remote directory collecting files matching a predicate. */
async function walkRemoteDir(session, dir, predicate, maxDepth = 6) {
  if (maxDepth < 0) return [];
  let listing;
  try {
    listing = await session.fs.list(dir);
  } catch (err) {
    if (err instanceof PathNotFoundError) return [];
    throw err;
  }
  const out = [];
  for (const item of listing) {
    if (!item || !item.name || item.name === '.' || item.name === '..') continue;
    if (item.type === 'directory') {
      out.push(...await walkRemoteDir(session, item.path, predicate, maxDepth - 1));
      continue;
    }
    if (item.type === 'symlink') continue;
    if (!predicate(item)) continue;
    out.push(item);
  }
  return out;
}

/**
 * POST /api/ftp/list-crashes
 * List .dmp and .log files recursively under /Diagnostics (or custom dir).
 */
router.post('/list-crashes', async (req, res) => {
  if (!requireCreds(req, res)) return;
  const profile = buildProfile({ ...req.body, timeoutMs: req.body.timeoutMs || 15000 });
  const baseDir = req.body.dir || '/Diagnostics';

  try {
    const entries = await withSession(profile, async (session) => {
      const files = await walkRemoteDir(
        session,
        baseDir,
        (item) => /\.(dmp|log)$/i.test(item.name || ''),
      );
      const mapped = files.map((f) => ({
        name: f.name,
        path: f.path,
        size: Number.isFinite(f.size) ? f.size : 0,
        modifiedAt: f.modifiedAt ? f.modifiedAt.toISOString() : null,
      }));
      mapped.sort((a, b) => {
        const aT = a.modifiedAt ? Date.parse(a.modifiedAt) : 0;
        const bT = b.modifiedAt ? Date.parse(b.modifiedAt) : 0;
        return bT - aT;
      });
      return mapped;
    });

    res.json({ ok: true, entries, baseDir });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * POST /api/ftp/download-binary
 * Download a file from the remote FTP server and return base64 payload.
 */
router.post('/download-binary', async (req, res) => {
  if (!requireCreds(req, res)) return;
  if (!req.body.remotePath) return res.status(400).json({ error: 'Missing remotePath' });
  const profile = buildProfile({ ...req.body, timeoutMs: req.body.timeoutMs || 20000 });
  const remotePath = req.body.remotePath;

  try {
    const buffer = await withSession(profile, async (session) => {
      let buf = await readToBuffer(session, remotePath);
      if (buf.length === 0) {
        // Fall back once — some servers need a second RETR after a 0-byte first try.
        buf = await readToBuffer(session, remotePath);
      }
      return buf;
    });

    if (buffer.length === 0) {
      return res.status(502).json({ error: `Downloaded 0 bytes from ${remotePath}.` });
    }
    res.json({ ok: true, base64: buffer.toString('base64'), size: buffer.length });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * POST /api/ftp/delete
 * Delete a remote file.
 */
router.post('/delete', async (req, res) => {
  if (!requireCreds(req, res)) return;
  if (!req.body.remotePath) return res.status(400).json({ error: 'Missing remotePath' });
  const profile = buildProfile(req.body);

  try {
    await withSession(profile, (session) => session.fs.remove(req.body.remotePath));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

module.exports = router;
