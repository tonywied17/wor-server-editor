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

module.exports = router;
