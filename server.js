const path = require('path');
const { createApp, json, cors, static: serveStatic, fetch } = require('molex-http');
const { parse, extractString } = require('molex-xml-js');
const FTPClient = require('molex-ftp');
require('molex-env').load();

const app = createApp();
app.use(cors());
app.use(json({ limit: '5mb' }));
app.use(serveStatic(path.join(__dirname, 'public')));

app.post('/validate', async (req, res) =>
{
  const steamids = Array.isArray(req.body.steamids) ? req.body.steamids : [];
  const concurrency = 6;
  const results = new Array(steamids.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, steamids.length) }).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= steamids.length) break;
      const id = steamids[i];
      try {
        const url = `https://steamcommunity.com/profiles/${encodeURIComponent(id)}/?xml=1`;
        const r = await fetch(url, { timeout: 8000 });
        if (!r.ok) { results[i] = { id, valid: false }; continue; }
        const text = await r.text();
        const parsed = parse(text);
        const player = parsed?.profile ? (Array.isArray(parsed.profile) ? parsed.profile[0] : parsed.profile) : {};
        const name = extractString(player?.steamID?.[0] || player?.steamID32?.[0] || null);
        const avatarRaw = player?.avatarFull?.[0] || player?.avatar?.[0] || null;
        const avatar = extractString(avatarRaw);
        results[i] = { id, valid: !!avatar, avatar, name };
      } catch (e) {
        results[i] = { id, valid: false };
      }
    }
  });

  await Promise.all(workers);
  res.json({ results });
});

app.post('/upload-ftp', async (req, res) =>
{
  const { host, port, username, password, xml, content, remotePath } = req.body;
  const payload = content || xml;
  if (!host || !username || !password || !payload) return res.status(400).json({ error: 'missing parameters' });

  const client = new FTPClient({
    debug: true,
    logger: (msg, ...args) => console.log(`[FTP Upload ${host}]`, msg, ...args)
  });

  client.on('error', (err) =>
  {
    console.error(`[FTP Upload ${host}] Client error:`, err.message);
  });

  try
  {
    await client.connect({ host, port: port || 21, user: username, password, timeout: 10000 });
    const target = remotePath || '/Assets/privileges.xml';
    await client.upload(payload, target, true);
    res.json({ ok: true, uploadedTo: target, message: 'File uploaded successfully' });
  } catch (err)
  {
    res.status(500).json({ error: err.message || String(err) });
  } finally
  {
    try { await client.close(); } catch (e) { /* ignore close errors */ }
  }
});

app.post('/download-ftp', async (req, res) =>
{
  const { host, port, username, password, remotePath } = req.body;
  if (!host || !username || !password) return res.status(400).json({ error: 'missing parameters' });

  const client = new FTPClient({
    debug: true,
    logger: (msg, ...args) => console.log(`[FTP Download ${host}]`, msg, ...args)
  });

  client.on('error', (err) =>
  {
    console.error(`[FTP Download ${host}] Client error:`, err.message);
  });

  try
  {
    await client.connect({ host, port: port || 21, user: username, password, timeout: 10000 });
    const target = remotePath || '/Assets/privileges.xml';

    const buffer = await client.download(target);
    const content = buffer.toString('utf8');

    res.json({ ok: true, content, message: 'File downloaded successfully' });
  } catch (err)
  {
    res.status(500).json({ error: err.message || String(err) });
  } finally
  {
    try { await client.close(); } catch (e) { /* ignore close errors */ }
  }
});

app.post('/check-ftp', async (req, res) =>
{
  const { host, port, username, password, remotePath } = req.body;
  if (!host || !username || !password) return res.status(400).json({ error: 'missing parameters' });

  const client = new FTPClient({
    debug: true,
    logger: (msg, ...args) => console.log(`[FTP Check ${host}]`, msg, ...args)
  });

  client.on('error', (err) =>
  {
    console.error(`[FTP Check ${host}] Client error:`, err.message);
  });

  try
  {
    await client.connect({ host, port: port || 21, user: username, password, timeout: 10000 });
    const target = remotePath || '/Assets/privileges.xml';
    const info = await client.stat(target);
    res.json({ exists: info.exists, size: info.size, message: info.exists ? 'File exists on server' : 'File not found on server' });
  } catch (err)
  {
    res.status(500).json({ error: err.message || String(err) });
  } finally
  {
    try { await client.close(); } catch (e) { /* ignore close errors */ }
  }
});

app.get('/resolve-steam', async (req, res) =>
{
  const profileUrl = req.query.profileUrl;
  const steamApiKey = process.menv.STEAM_API_KEY;
  if (!profileUrl) return res.status(400).json({ error: 'profileUrl query param required' });

  try
  {
    const steamIdMatch = profileUrl.match(/\/id\/([^/]+)|\/profiles\/(\d+)/);
    if (!steamIdMatch) return res.status(400).json({ error: 'Invalid Steam profile URL' });

    const vanityName = steamIdMatch[1];
    const steamIdNumeric = steamIdMatch[2];

    let resolvedSteamId64;
    if (vanityName)
    {
      if (!steamApiKey) return res.status(500).json({ error: 'STEAM_API_KEY not configured' });
      const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${steamApiKey}&vanityurl=${encodeURIComponent(vanityName)}`;
      const r = await fetch(url, { timeout: 8000 });
      if (!r.ok) return res.status(500).json({ error: 'Failed to call Steam API' });
      const d = await r.json();
      if (!d.response || d.response.success !== 1) return res.status(400).json({ error: 'Could not resolve vanity URL' });
      resolvedSteamId64 = d.response.steamid;
    } else
    {
      resolvedSteamId64 = steamIdNumeric;
    }

    const profileXmlUrl = `https://steamcommunity.com/profiles/${encodeURIComponent(resolvedSteamId64)}/?xml=1`;
    const pr = await fetch(profileXmlUrl, { timeout: 8000 });
    if (!pr.ok) return res.status(500).json({ error: 'Failed to fetch Steam profile' });
    const text = await pr.text();
    const parsed = parse(text);
    const player = parsed?.profile ? (Array.isArray(parsed.profile) ? parsed.profile[0] : parsed.profile) : {};
    const name = extractString(player?.steamID?.[0] || player?.steamID32?.[0] || null);
    const avatar = extractString(player?.avatarFull?.[0] || player?.avatar?.[0] || null);

    return res.json({ steamid64: String(resolvedSteamId64), avatar, name });
  } catch (err)
  {
    console.error('resolve-steam error', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.menv.PORT || 7272;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
