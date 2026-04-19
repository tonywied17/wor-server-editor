const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function validateSteamIds(steamids) {
  const response = await fetch(`${API_BASE}/api/steam/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steamids }),
  });
  if (!response.ok) throw new Error((await parseJson(response)).error || 'Steam validation failed');
  return parseJson(response);
}

export async function resolveSteamProfile(profileUrl) {
  const response = await fetch(`${API_BASE}/api/steam/resolve?profileUrl=${encodeURIComponent(profileUrl)}`);
  if (!response.ok) throw new Error((await parseJson(response)).error || 'Steam profile resolution failed');
  return parseJson(response);
}

export async function ftpDownload(payload) {
  const response = await fetch(`${API_BASE}/api/ftp/download`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await parseJson(response)).error || 'FTP download failed');
  return parseJson(response);
}

export async function ftpUpload(payload) {
  const response = await fetch(`${API_BASE}/api/ftp/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await parseJson(response)).error || 'FTP upload failed');
  return parseJson(response);
}

export async function ftpCheck(payload) {
  const response = await fetch(`${API_BASE}/api/ftp/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await parseJson(response)).error || 'FTP check failed');
  return parseJson(response);
}
