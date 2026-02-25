const { fetch } = require('molex-http');
const { parse } = require('molex-xml-js');

(async () => {
  try {
    const url = 'https://steamcommunity.com/profiles/76561197960287930/?xml=1';
    const r = await fetch(url, { timeout: 8000 });
    const txt = await r.text();
    const parsed = parse(txt);
    console.log('profile keys:', Object.keys(parsed.profile));
    console.log(JSON.stringify(parsed.profile, null, 2).slice(0, 1000));
  } catch (e) {
    console.error('error', e && e.message ? e.message : e);
  }
})();
