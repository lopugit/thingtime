// Single source of truth for the Content-Security-Policy.
//
// Consumed by:
// - scripts/patch-vercel-output.mjs  → production headers in .vercel/output/config.json
// - vite.config.ts                   → dev-server headers (dev variant)
// - scripts/verify-vercel-output.mjs → build-time assertions
//
// The application policy deliberately has NO 'unsafe-eval': persisted-state
// function revival was removed from ThingtimeProvider and Commander
// assignments use a data-literal parser. Opt-in smarts scoped-eval modes remain
// blocked by this policy. The repo-controlled
// design prototypes have a narrowly scoped
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

// The virtual-hosted S3 endpoint the signed part/content URLs use. Mirrors
// api/utils/attachments/config.ts (getPrivateS3Config) without importing
// server code into this build-time script.
const privateS3Origin = () => {
	const bucket = String(process.env.THINGTIME_PRIVATE_S3_BUCKET || '').trim();
	const region = String(process.env.THINGTIME_PRIVATE_S3_REGION || '').trim();
	if (bucket && region) return `https://${bucket}.s3.${region}.amazonaws.com`;
	return `https://*.s3.${region || 'ap-southeast-2'}.amazonaws.com`;
};

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
		// Direct-to-S3 attachment uploads: the composer PUTs signed multipart
		// parts straight at the private bucket (attachments/privateS3), so the
		// bucket origin must be connectable or every upload dies at the browser
		// with "The file could not reach storage." Exact origin when the build
		// env carries the bucket config; regional wildcard fallback otherwise
		// (local/preview builds without the sensitive env).
		privateS3Origin(),
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

// The Limitless MCP Lab embeds the exact, server-served MCP App HTML in a
// sandboxed srcdoc iframe. srcdoc inherits the parent document's CSP, so the
// review app's one inline module needs an exact hash on this route. Keep the
// exception hash-only: never broaden the application policy with
// 'unsafe-inline'. pluginLimitlessCore.test.ts proves this hash still matches
// renderThingtimeMcpUi() whenever the embedded app changes.
export const mcpLabScriptHash = "'sha256-InujfRsBJ3VWJN0FJ9O1huZAeiHmJtIQbhm2Q3ZHwxE='";
export const mcpLabCsp = serialize({
	...directives(),
	'script-src': [...directives()['script-src'], mcpLabScriptHash]
});

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
	sandbox: ['allow-scripts', 'allow-forms', 'allow-modals', 'allow-popups', 'allow-downloads']
});

// /authorize must additionally never render inside a frame (UI-redress
// hardening) — same policy plus frame-ancestors 'none'.
export const authorizeCsp = `${prodCsp}; frame-ancestors 'none'`;
