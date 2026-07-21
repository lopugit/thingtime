// Single source of truth for the Content-Security-Policy.
//
// Consumed by:
// - scripts/patch-vercel-output.mjs  → production headers in .vercel/output/config.json
// - vite.config.ts                   → dev-server headers (dev variant)
// - scripts/verify-vercel-output.mjs → build-time assertions
//
// The policy deliberately has NO 'unsafe-eval': persisted-state function
// revival was removed from ThingtimeProvider, and eval-backed magic (Commander
// code commands, smarts scoped-eval replace mode) is expected to fail closed
// under this policy rather than re-open storage-payload code execution.
//
// External hosts:
// - cdn.jsdelivr.net       @monaco-editor/react default loader (scripts, css, fonts)
// - fonts.googleapis.com   Google Fonts stylesheet (index.html)
// - fonts.gstatic.com      Google Fonts font files
// - va.vercel-scripts.com  @vercel/analytics debug script (dev; harmless in prod)
// User content (posts, avatars, audio) may reference arbitrary https URLs, so
// img-src / media-src allow https:. Embeds render as link-out cards, never
// iframes, so frame-src stays 'self' (docs design-bundle previews).

const directives = ({ dev = false } = {}) => ({
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    'https://cdn.jsdelivr.net',
    'https://va.vercel-scripts.com',
    // Dev only: @vitejs/plugin-react injects an inline react-refresh preamble.
    ...(dev ? ["'unsafe-inline'"] : [])
  ],
  // Emotion/Chakra inject inline <style> tags at runtime; 'unsafe-inline' for
  // styles is required until style nonces/hashes are wired through Emotion.
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'media-src': ["'self'", 'data:', 'blob:', 'https:'],
  'connect-src': [
    "'self'",
    'https://cdn.jsdelivr.net',
    // Dev only: Vite HMR websocket (separate port) + analytics debug beacons.
    ...(dev ? ['ws:', 'wss:', 'https://va.vercel-scripts.com'] : [])
  ],
  'worker-src': ["'self'", 'blob:'],
  'frame-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"]
});

const serialize = (dirs) =>
  Object.entries(dirs)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');

export const buildCsp = (opts = {}) => serialize(directives(opts));

export const prodCsp = buildCsp();
export const devCsp = buildCsp({ dev: true });

// The static prototype bundles under /docs/design-bundles are self-contained
// generated pages with inline scripts (no eval). They get the same policy with
// inline scripts allowed.
export const designBundlesCsp = serialize({
  ...directives(),
  'script-src': ["'self'", "'unsafe-inline'"]
});

// /authorize must additionally never render inside a frame (UI-redress
// hardening) — same policy plus frame-ancestors 'none'.
export const authorizeCsp = `${prodCsp}; frame-ancestors 'none'`;
