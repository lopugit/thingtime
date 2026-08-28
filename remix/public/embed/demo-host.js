// The demo host page's own code, loaded before /embed/thingtime.min.js.
//
// External rather than inline because every deployed path is served under the
// strict application CSP (`script-src 'self'`, no 'unsafe-inline' and no
// hash/nonce allowance — scripts/patch-vercel-output.mjs stamps it on
// `/(?:.*)`). An inline block here still parses into the page and is then
// refused by the browser, so the canaries below would never be planted and the
// isolation verdict would hang on "Checking host isolation…" on every real
// deployment. The dev server uses devCsp, which does allow inline scripts, so
// local QA cannot see the difference.

const titlePrefix = location.hostname.endsWith('.ts.net') ? '[TS]' : ['localhost', '127.0.0.1', '::1'].includes(location.hostname) ? '[LC]' : '[DV]';
document.title = `${titlePrefix} Thingtime embed demo`;

// Host-integrity canaries: the embed must leave common globals owned by the
// website exactly as it found them.
window.process = { owner: 'demo-host', env: { DEMO: 'untouched' } };
window.meta = { owner: 'demo-host' };
window.tt = { owner: 'demo-host' };
window.thingtime = { owner: 'demo-host' };
window.smarts = { owner: 'demo-host' };
window.__thingtimeXss = false;
