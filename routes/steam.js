const { Router } = require('@zero-server/core');
const { fetch } = require('@zero-server/fetch');
const { env } = require('@zero-server/env');
const { parse, extractString } = require('molex-xml-js');

const router = Router();

/**
 * POST /api/steam/validate
 * Validate Steam IDs in parallel (up to 6 concurrent).
 */
router.post('/validate', async (req, res) => {
  const steamids = Array.isArray(req.body.steamids) ? req.body.steamids : [];
  if (!steamids.length) return res.json({ results: [] });

  const concurrency = 6;
  const results = new Array(steamids.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, steamids.length) }, async () => {
    while (cursor < steamids.length) {
      const i = cursor++;
      const id = steamids[i];
      try {
        const url = `https://steamcommunity.com/profiles/${encodeURIComponent(id)}/?xml=1`;
        const r = await fetch(url, { timeout: 8000 });
        if (!r.ok) { results[i] = { id, valid: false }; continue; }
        const text = await r.text();
        const parsed = parse(text);
        const player = parsed?.profile
          ? (Array.isArray(parsed.profile) ? parsed.profile[0] : parsed.profile)
          : {};
        const name = extractString(player?.steamID?.[0] || player?.steamID32?.[0] || null);
        const avatar = extractString(player?.avatarFull?.[0] || player?.avatar?.[0] || null);
        results[i] = { id, valid: !!avatar, avatar, name };
      } catch {
        results[i] = { id, valid: false };
      }
    }
  });

  await Promise.all(workers);
  res.json({ results });
});

/**
 * GET /api/steam/resolve?profileUrl=...
 * Resolve a Steam profile URL (vanity or numeric) to a SteamID64 + profile info.
 */
router.get('/resolve', async (req, res) => {
  const profileUrl = req.query.profileUrl;
  if (!profileUrl) return res.status(400).json({ error: 'profileUrl query param required' });

  const match = profileUrl.match(/\/id\/([^/]+)|\/profiles\/(\d+)/);
  if (!match) return res.status(400).json({ error: 'Invalid Steam profile URL' });

  const vanityName = match[1];
  const numericId = match[2];

  let steamId64;
  if (vanityName) {
    const apiKey = env.STEAM_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'STEAM_API_KEY not configured' });
    const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${encodeURIComponent(vanityName)}`;
    const r = await fetch(url, { timeout: 8000 });
    if (!r.ok) return res.status(500).json({ error: 'Failed to call Steam API' });
    const d = await r.json();
    if (!d.response || d.response.success !== 1) return res.status(400).json({ error: 'Could not resolve vanity URL' });
    steamId64 = d.response.steamid;
  } else {
    steamId64 = numericId;
  }

  const xmlUrl = `https://steamcommunity.com/profiles/${encodeURIComponent(steamId64)}/?xml=1`;
  const pr = await fetch(xmlUrl, { timeout: 8000 });
  if (!pr.ok) return res.status(500).json({ error: 'Failed to fetch Steam profile' });
  const text = await pr.text();
  const parsed = parse(text);
  const player = parsed?.profile
    ? (Array.isArray(parsed.profile) ? parsed.profile[0] : parsed.profile)
    : {};
  const name = extractString(player?.steamID?.[0] || player?.steamID32?.[0] || null);
  const avatar = extractString(player?.avatarFull?.[0] || player?.avatar?.[0] || null);

  res.json({ steamid64: String(steamId64), avatar, name });
});

module.exports = router;
