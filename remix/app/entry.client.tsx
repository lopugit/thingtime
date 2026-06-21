import { RemixBrowser } from '@remix-run/react';
import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

// Minimal shim: some client deps read `process.env.*`. Define it (with an `env`
// object) so those reads return undefined instead of throwing. The previous
// code set `window.process = {}`, which left `process.env` undefined and could
// throw during module init — breaking hydration entirely.
try {
  // @ts-ignore - window.process isn't part of the DOM lib types
  if (!window.process) window.process = { env: {} };
} catch (err) {
  // nothing
}

// React 18: hydrate the whole document with hydrateRoot (the old React-17
// `ReactDOM.hydrate(<RemixBrowser/>, document)` API silently fails on React 18,
// so event handlers never attach and forms fall back to a native submit).
startTransition(() => {
  hydrateRoot(document, <RemixBrowser />);
});
