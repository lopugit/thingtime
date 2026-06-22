import { RemixBrowser } from '@remix-run/react';
import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

// Minimal shim: some client deps read `process.env.*`. Define it (with an `env`
// object) so those reads return undefined instead of throwing.
try {
  // @ts-ignore - window.process isn't part of the DOM lib types
  if (!window.process) window.process = { env: {} };
} catch (err) {
  // nothing
}

// --- TEMPORARY hydration diagnostic -----------------------------------------
// Surfaces client-side errors as a visible banner so issues can be diagnosed on
// devices without a console. Remove once hydration is confirmed healthy.
const showDiag = (label: string, detail: string) => {
  try {
    let el = document.getElementById('tt-diag');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tt-diag';
      el.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b00020;color:#fff;' +
        'font:11px/1.4 monospace;padding:8px;white-space:pre-wrap;max-height:55vh;overflow:auto;';
      document.body.appendChild(el);
    }
    el.textContent = (el.textContent ? el.textContent + '\n\n' : '') + `[${label}] ${detail}`.slice(0, 1500);
  } catch {
    // nothing
  }
};

try {
  window.addEventListener('error', (e: any) => showDiag('error', `${e?.message}\n${e?.error?.stack || ''}`));
  window.addEventListener('unhandledrejection', (e: any) =>
    showDiag('promise', `${e?.reason?.message || e?.reason}\n${e?.reason?.stack || ''}`)
  );
} catch {
  // nothing
}
// ----------------------------------------------------------------------------

// React 18: hydrate the whole document with hydrateRoot.
startTransition(() => {
  hydrateRoot(document, <RemixBrowser />, {
    onRecoverableError: (error: any) => showDiag('hydration', `${error?.message}\n${error?.stack || ''}`)
  });
});
