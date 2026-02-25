
//! validateSingle - validate a single steam id via API
//! \param id - steamid64 string
export async function validateSingle(id)
{
    try
    {
        const r = await fetch('/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ steamids: [id] }) });
        if (!r.ok) return null;
        const j = await r.json();
        try { console.debug('[api] validateSingle response for', id, j); } catch (e) { }
        return (j.results || [])[0] || null;
    } catch (e) { return null; }
}

//! validateBatch - validate multiple steam ids via API
//! \param ids - array of steamid64 strings
export async function validateBatch(ids)
{
    try
    {
        const r = await fetch('/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ steamids: ids }) });
        if (!r.ok) return null;
        const j = await r.json();
        try { console.debug('[api] validateBatch response', j); } catch (e) { }
        return j.results || [];
    } catch (e) { return null; }
}

//! resolveSteamProfile - resolve a steam profile URL to steamid
//! \param profileUrl - URL or identifier to resolve
export async function resolveSteamProfile(profileUrl)
{
    try
    {
        const q = '/resolve-steam?profileUrl=' + encodeURIComponent(profileUrl);
        const r = await fetch(q, { method: 'GET' });
        if (!r.ok) return null;
        const j = await r.json();
        try { console.debug('[api] resolveSteamProfile response for', profileUrl, j); } catch (e) { }
        return j;
    } catch (e) { return null; }
}

//! doFtpUpload - upload server file (XML or CFG) to FTP via server proxy
//! \param {host,port,user,pass,content,remotePath} - ftp options (content may be XML or CFG text)
export async function doFtpUpload({ host, port, user, pass, content, remotePath })
{
    const body = { host, username: user, password: pass, content };
    if (port) body.port = port;
    body.remotePath = remotePath || '/Assets/privileges.xml';
    const r = await fetch('/upload-ftp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, json: j };
}

//! testFtpConnection - test connectivity to FTP host
//! \param {host,port,user,pass,remotePath} - ftp options
export async function testFtpConnection({ host, port, user, pass, remotePath })
{
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try
    {
        const body = { host, port: port || 21, username: user, password: pass };
        body.remotePath = remotePath || '/Assets/privileges.xml';
        const r = await fetch('/check-ftp', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const j = await r.json().catch(() => ({}));
        return { ok: r.ok, json: j };
    } catch (err)
    {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError')
        {
            return { ok: false, json: { error: 'Connection timeout - check your host, port, and firewall settings' } };
        }
        throw err;
    }
}
