// Render-blocking boot script (loaded from index.html <head>). External so the
// Content-Security-Policy can stay `script-src 'self'` without inline-script
// hashes that break on every edit.

// Pre-paint theme snapshot: apply the last computed --tt-* variables
// before React loads so custom themes never flash the defaults.
(() => {
  try {
    const raw = window.localStorage.getItem('tt-theme-vars');
    if (!raw) return;
    const vars = JSON.parse(raw);
    if (!vars || typeof vars !== 'object') return;
    for (const key in vars) {
      if (/^--tt-[\w-]+$/.test(key) && typeof vars[key] === 'string') {
        document.documentElement.style.setProperty(key, vars[key]);
      }
    }
  } catch (error) {
    // ignore — defaults from the stylesheet apply
  }
})();

// Environment/source tab-title prefix for at-a-glance tab management.
(() => {
  const host = window.location.hostname;
  const prefix = host === 'localhost' || host === '127.0.0.1'
    ? '[LC]'
    : host.endsWith('.vercel.app')
      ? '[VC]'
      : host.endsWith('.ts.net')
        ? '[TS]'
        : '';

  if (prefix) {
    document.title = `${prefix} Thingtime`;
  }
})();
