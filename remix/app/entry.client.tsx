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

// React 18: hydrate the whole document with hydrateRoot. (Single Fetch streams
// the loader data, so the SSR side must use a streaming renderer — see
// entry.server.tsx — or hydration suspends forever and no handlers attach.)
startTransition(() => {
  hydrateRoot(document, <RemixBrowser />);
});
