const { fetch } = require('molex-http');

(async () => {
  try {
    const url = 'https://steamcommunity.com/profiles/76561197960287930/?xml=1';
    const r = await fetch(url, { timeout: 8000 });
    console.log('ok?', r.ok, 'status', r.status);
    const txt = await r.text();
    console.log('len', txt.length);
    console.log(txt.slice(0, 800));
  } catch (e) {
    console.error('fetch error', e && e.message ? e.message : e);
  }
})();
