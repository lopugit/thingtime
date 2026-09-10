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

// The entry module cannot install a recovery listener if one of its own static
// imports fails. Listen from this earlier classic script, while the root is
// still empty. Share the lazy-chunk guard so recovery never becomes a loop.
(() => {
  const guard = 'tt-chunk-reload';
  let handled = false;
  const showRecovery = () => {
    const root = document.getElementById('root');
    if (!root || root.hasChildNodes()) return;
    const surface = document.createElement('main');
    surface.id = 'tt-boot-recovery';
    surface.setAttribute('role', 'alert');
    surface.style.cssText = 'min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:Canvas;color:CanvasText;font:16px/1.5 system-ui,sans-serif';
    const content = document.createElement('section');
    content.style.cssText = 'max-width:32rem;width:100%;box-sizing:border-box';
    const title = document.createElement('h1');
    title.textContent = 'Thingtime could not start';
    title.style.cssText = 'font-size:24px;line-height:1.25;margin:0 0 16px';
    const description = document.createElement('p');
    description.textContent = 'A required app file did not load. Try again when your connection is ready.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.style.cssText = 'padding:10px 16px;margin-top:8px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:8px;cursor:pointer';
    retry.addEventListener('click', () => window.location.reload());
    content.append(title, description, retry);
    surface.append(content);
    root.append(surface);
  };

  window.addEventListener('error', (event) => {
    const script = event.target;
    if (handled || !script || script.tagName !== 'SCRIPT' || script.type !== 'module' || !script.src) return;
    try {
      if (new URL(script.src, window.location.href).origin !== window.location.origin) return;
    } catch { return; }
    const root = document.getElementById('root');
    if (root?.hasChildNodes()) return; // Never replace prior/optimistic content.
    handled = true;
    try {
      if (!window.sessionStorage.getItem(guard)) {
        window.sessionStorage.setItem(guard, String(Date.now()));
        window.location.reload();
        return;
      }
    } catch {
      // Private browsing may deny durable storage. Without a guard, offer a
      // manual retry only instead of risking an automatic reload loop.
    }
    if (root) showRecovery();
    else document.addEventListener('DOMContentLoaded', showRecovery, { once: true });
  }, true);
})();
