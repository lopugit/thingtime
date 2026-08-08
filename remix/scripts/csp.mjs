// Single source of truth for the Content-Security-Policy.
//
// Consumed by:
// - scripts/patch-vercel-output.mjs  → production headers in .vercel/output/config.json
// - vite.config.ts                   → dev-server headers (dev variant)
// - scripts/verify-vercel-output.mjs → build-time assertions
//
// The application policy deliberately has NO 'unsafe-eval': persisted-state
// function revival was removed from ThingtimeProvider, and eval-backed magic
// (Commander code commands, smarts scoped-eval replace mode) is expected to
// fail closed under this policy rather than re-open storage-payload code
// execution. The repo-controlled design prototypes have a narrowly scoped
// compatibility policy below because their generated runtime compiles templates
// with Function; that exception never applies to the application shell.
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

// The static prototype bundles under /docs/design-bundles are repo-controlled
// generated pages. Their Design Components runtime compiles templates with
// Function and loads pinned React/Babel UMD assets from unpkg, so this path gets
// a narrowly scoped compatibility exception. Do not reuse it for app routes.
export const designBundlesCsp = serialize({
  ...directives(),
  'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://unpkg.com'],
  'connect-src': ["'self'", 'https://unpkg.com'],
  // Opaque-origin sandbox: generated runtime code cannot reach Thingtime's
  // cookies/storage even when a prototype is opened directly. Static bundle
  // responses expose CORS so relative component fetches still work.
  sandbox: [
    'allow-scripts',
    'allow-forms',
    'allow-modals',
    'allow-popups',
    'allow-downloads'
  ]
});

// /authorize must additionally never render inside a frame (UI-redress
// hardening) — same policy plus frame-ancestors 'none'.
export const authorizeCsp = `${prodCsp}; frame-ancestors 'none'`;
