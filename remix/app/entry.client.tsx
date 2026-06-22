import { RemixBrowser } from '@remix-run/react';
import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

// Minimal shim: some client deps read `process.env.*`.
try {
  // @ts-ignore - window.process isn't part of the DOM lib types
  if (!window.process) window.process = { env: {} };
} catch (err) {
  // nothing
}

// --- TEMPORARY hydration diagnostic -----------------------------------------
// Shows a fixed banner so client status is visible on devices without a console.
//   red    = a JS / hydration error (text shown)
//   green  = client JS ran + no errors (so any remaining issue is CSS, not JS)
//   absent = the client bundle never executed at all
// Remove once hydration is confirmed healthy.
const banner = (text: string, ok: boolean) => {
  try {
    let el = document.getElementById('tt-diag');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tt-diag';
      document.body.appendChild(el);
    }
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:2147483647;color:#fff;font:11px/1.4 monospace;' +
      'padding:8px;white-space:pre-wrap;max-height:60vh;overflow:auto;background:' +
      (ok ? '#0a7d33' : '#b00020');
    el.textContent = text.slice(0, 1500);
  } catch {
    // nothing
  }
};

let sawError = false;
const onErr = (label: string, detail: string) => {
  sawError = true;
  banner(`${label}: ${detail}`, false);
};

try {
  window.addEventListener('error', (e: any) => onErr('JS ERROR', `${e?.message}\n${e?.error?.stack || ''}`));
  window.addEventListener('unhandledrejection', (e: any) =>
    onErr('PROMISE REJECTION', `${e?.reason?.message || e?.reason}\n${e?.reason?.stack || ''}`)
  );
} catch {
  // nothing
}
// ----------------------------------------------------------------------------

startTransition(() => {
  hydrateRoot(document, <RemixBrowser />, {
    onRecoverableError: (error: any) => onErr('HYDRATION MISMATCH', `${error?.message}\n${error?.stack || ''}`)
  });
});

// Positive marker (after hydration settles): proves the client JS executed and
// no errors fired — so if the page still isn't interactive, it's CSS, not JS.
setTimeout(() => {
  if (!sawError) banner('✓ client JS ran, hydrated, no errors. Try typing in the form + tap Create account.', true);
}, 2500);
