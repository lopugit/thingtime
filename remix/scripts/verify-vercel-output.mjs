#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { authorizeCsp, designBundlesCsp, mcpLabCsp, mcpLabScriptHash, prodCsp } from './csp.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const indexHtml = readFileSync('.vercel/output/static/index.html', 'utf8');
const bootScript = readFileSync('.vercel/output/static/tt-boot.js', 'utf8');
const previewFreshnessScript = readFileSync('.vercel/output/static/tt-preview-freshness.js', 'utf8');
const config = readJson('.vercel/output/config.json');
const serverFunctionDir = '.vercel/output/functions/__server.func';

const filesBelow = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? filesBelow(path) : [path];
	});

// Nitro may leave createRequire(import.meta.url)("package/file.json") in a
// server chunk. Vercel's dependency tracer does not follow that indirection,
// so the build looks healthy but the deployed route throws MODULE_NOT_FOUND.
// A static import is bundled and has no runtime package lookup. If a future
// build deliberately externalizes the package instead, accepting it remains
// safe only when the traced function contains the requested JSON asset.
const emojiRuntimeSpecifier = 'unicode-emoji-json/data-by-emoji.json';
const emojiCreateRequirePattern = new RegExp(
	`createRequire\\([^)]*\\)\\s*\\(\\s*["']${emojiRuntimeSpecifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\\s*\\)`
);
const unresolvedEmojiLookup = filesBelow(serverFunctionDir).find(
	(path) => path.endsWith('.mjs') && emojiCreateRequirePattern.test(readFileSync(path, 'utf8'))
);
const tracedEmojiAsset = join(serverFunctionDir, 'node_modules', ...emojiRuntimeSpecifier.split('/'));
if (unresolvedEmojiLookup && !existsSync(tracedEmojiAsset)) {
	throw new Error(
		`Vercel server output leaves ${emojiRuntimeSpecifier} as a runtime lookup without tracing the JSON asset (${unresolvedEmojiLookup}).`
	);
}

const getDirectiveSources = (policy, name) => {
	const directive = policy
		.split(';')
		.map((part) => part.trim())
		.find((part) => part === name || part.startsWith(`${name} `));
	if (!directive) {
		throw new Error(`Application CSP is missing ${name}.`);
	}
	return directive.split(/\s+/).slice(1);
};

if (!indexHtml.includes('<div id="root"></div>')) {
	throw new Error('Vercel output is missing the Vite root shell.');
}

const appScriptSources = getDirectiveSources(prodCsp, 'script-src');
for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'"]) {
	if (appScriptSources.includes(forbidden)) {
		throw new Error(`Application script-src must not contain ${forbidden}.`);
	}
}

// Every executable script must be external and same-origin. The policy has no
// inline hash/nonce allowance, so an inline bootstrap would be present in the
// HTML but silently blocked by the browser.
const inlineExecutableScripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script[^>]*>/gi)].filter(([, attributes]) => {
	if (/\bsrc\s*=/i.test(attributes)) return false;
	const typeMatch = attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
	const type = (typeMatch?.[1] || typeMatch?.[2] || typeMatch?.[3] || '').toLowerCase();
	return !type || type === 'module' || type === 'text/javascript' || type === 'application/javascript';
});
if (inlineExecutableScripts.length > 0) {
	throw new Error('Vercel shell contains an inline executable script that the strict CSP must block.');
}
if (!indexHtml.includes('src="/tt-boot.js"') || bootScript.trim().length === 0) {
	throw new Error('Vercel output is missing the external pre-paint /tt-boot.js script.');
}
if (
	!indexHtml.includes('src="/tt-preview-freshness.js"') ||
	!indexHtml.includes('data-thingtime-preview-freshness') ||
	previewFreshnessScript.trim().length === 0
) {
	throw new Error('Vercel output is missing the external preview-freshness bootstrap.');
}

const previewFreshnessIndex = indexHtml.indexOf('data-thingtime-preview-freshness');
const appEntryTag = [...indexHtml.matchAll(/<script\b[^>]*>/gi)].find(
	(match) => /\btype=["']module["']/i.test(match[0]) && /\bsrc=["'][^"']*\/assets\/index-[^"']+\.js/i.test(match[0])
);
const appEntryIndex = appEntryTag?.index ?? -1;
if (previewFreshnessIndex === -1 || appEntryIndex === -1 || previewFreshnessIndex > appEntryIndex) {
	throw new Error('Vercel output does not load preview recovery before the application entry.');
}

const hasFilesystemRoute = config.routes?.some((route) => route.handle === 'filesystem');
if (!hasFilesystemRoute) {
	throw new Error('Vercel output config does not check filesystem routes before server fallback.');
}

const routes = config.routes ?? [];
const filesystemIndex = routes.findIndex((route) => route.handle === 'filesystem');
const apiIndex = routes.findIndex((route) => route.src === '/api/(?:.*)');
const rootIndex = routes.findIndex((route) => route.src === '^/$' && route.dest === '/index.html');
const directIndex = routes.findIndex((route) => route.src === '^/index\\.html$' && route.dest === '/index.html');
const spaIndex = routes.findIndex((route) => route.src === '/(?:.*)' && route.dest === '/index.html');
const wellKnownDiscoveryIndex = routes.findIndex(
	(route) =>
		route.src === '^/\\.well-known/(?:oauth-protected-resource|oauth-authorization-server|thingtime-chatgpt-capabilities\\.json|thingtime-capabilities\\.json)$' &&
		route.dest === '/__server'
);
const serverFallbackIndex = routes.findIndex((route, index) => route.dest === '/__server' && index !== wellKnownDiscoveryIndex);

if (spaIndex === -1) {
	throw new Error('Vercel output config does not route non-API app paths to /index.html.');
}

if (rootIndex === -1) {
	throw new Error('Vercel output config does not route / to /index.html.');
}

if (directIndex === -1) {
	throw new Error('Vercel output config does not route /index.html to the static shell.');
}

const expectedAppShellCacheControl = 'private, no-store, max-age=0, must-revalidate';
for (const [name, index] of [
	['root', rootIndex],
	['direct index', directIndex],
	['SPA fallback', spaIndex]
]) {
	const headers = routes[index]?.headers;
	if (headers?.['Cache-Control'] !== expectedAppShellCacheControl || headers?.Pragma !== 'no-cache' || headers?.Expires !== '0') {
		throw new Error(`Vercel output ${name} route does not disable browser caching for the HTML shell.`);
	}
}

if (rootIndex > filesystemIndex) {
	throw new Error('Vercel output checks filesystem routes before the / static shell rewrite.');
}

if (filesystemIndex > spaIndex) {
	throw new Error('Vercel output checks the SPA fallback before static filesystem assets.');
}

if (wellKnownDiscoveryIndex === -1) {
	throw new Error('Vercel output does not route OAuth and Thingtime capability discovery to Nitro.');
}

if (wellKnownDiscoveryIndex > filesystemIndex || wellKnownDiscoveryIndex > spaIndex) {
	throw new Error('Vercel output checks static or SPA fallbacks before well-known discovery.');
}

if (apiIndex > spaIndex) {
	throw new Error('Vercel output checks the SPA fallback before API routes.');
}

if (rootIndex > spaIndex) {
	throw new Error('Vercel output checks the catch-all SPA fallback before the / route.');
}

if (serverFallbackIndex !== -1 && serverFallbackIndex < spaIndex) {
	throw new Error('Vercel output checks the Nitro server fallback before the SPA shell.');
}

const authorizeHeadersIndex = routes.findIndex(
	(route) =>
		route.continue === true &&
		typeof route.src === 'string' &&
		route.src.includes('/authorize') &&
		route.headers?.['X-Frame-Options'] === 'DENY' &&
		route.headers?.['Content-Security-Policy'] === authorizeCsp
);
if (authorizeHeadersIndex === -1) {
	throw new Error('Vercel output config does not frame-deny the /authorize consent page.');
}
if (authorizeHeadersIndex > spaIndex) {
	throw new Error('Vercel output stamps /authorize frame-deny headers after the SPA fallback.');
}

const cspHeadersIndex = routes.findIndex(
	(route) => route.continue === true && route.src === '/(?:.*)' && route.headers?.['Content-Security-Policy'] === prodCsp
);
if (cspHeadersIndex === -1) {
	throw new Error('Vercel output config does not stamp the global Content-Security-Policy.');
}
if (cspHeadersIndex > spaIndex) {
	throw new Error('Vercel output stamps the global CSP after the SPA fallback.');
}
if (cspHeadersIndex > authorizeHeadersIndex) {
	throw new Error('Vercel output stamps the global CSP after the /authorize override, so /authorize would lose frame-ancestors.');
}
const designBundlesHeadersIndex = routes.findIndex(
	(route) =>
		route.continue === true &&
		route.src === '^/docs/design-bundles(?:/.*)?$' &&
		route.headers?.['Content-Security-Policy'] === designBundlesCsp &&
		route.headers?.['Access-Control-Allow-Origin'] === '*'
);
if (designBundlesHeadersIndex === -1) {
	throw new Error('Vercel output config is missing the scoped design-bundle CSP.');
}
if (designBundlesHeadersIndex < cspHeadersIndex || designBundlesHeadersIndex > spaIndex) {
	throw new Error('Vercel output does not apply the design-bundle CSP after the global policy and before routing.');
}
const mcpLabHeadersIndex = routes.findIndex(
	(route) =>
		route.continue === true &&
		route.src === '^/docs/mcp/?$' &&
		route.headers?.['Content-Security-Policy'] === mcpLabCsp
);
if (mcpLabHeadersIndex === -1) {
	throw new Error('Vercel output config is missing the hash-scoped Limitless MCP Lab CSP.');
}
if (mcpLabHeadersIndex < cspHeadersIndex || mcpLabHeadersIndex > spaIndex) {
	throw new Error('Vercel output does not apply the Limitless MCP Lab CSP after the global policy and before routing.');
}
for (const route of routes) {
	const csp = route.headers?.['Content-Security-Policy'];
	if (typeof csp === 'string' && csp.includes('unsafe-eval') && csp !== designBundlesCsp) {
		throw new Error(`Vercel output CSP re-introduces 'unsafe-eval' outside design bundles (route ${route.src}).`);
	}
}
const mcpLabScriptSources = new Set(getDirectiveSources(mcpLabCsp, 'script-src'));
if (
	!mcpLabScriptSources.has(mcpLabScriptHash) ||
	mcpLabScriptSources.has("'unsafe-inline'") ||
	mcpLabScriptSources.has("'unsafe-eval'")
) {
	throw new Error('Limitless MCP Lab CSP lost its exact hash-only script exception.');
}
// Sets make these exact CSP-token checks. A string substring check would also
// accept an attacker-controlled host that merely embeds the approved URL.
const designBundleScriptSources = new Set(getDirectiveSources(designBundlesCsp, 'script-src'));
const designBundleConnectSources = new Set(getDirectiveSources(designBundlesCsp, 'connect-src'));
const designBundleSandboxTokens = new Set(getDirectiveSources(designBundlesCsp, 'sandbox'));
if (
	!designBundleScriptSources.has("'unsafe-eval'") ||
	!designBundleScriptSources.has('https://unpkg.com') ||
	!designBundleConnectSources.has('https://unpkg.com') ||
	!designBundleSandboxTokens.has('allow-scripts')
) {
	throw new Error('Design-bundle CSP lost its generated-runtime compatibility sources.');
}
if (
	designBundleSandboxTokens.has('allow-same-origin') ||
	designBundleSandboxTokens.has('allow-popups-to-escape-sandbox')
) {
	throw new Error('Design-bundle CSP lost its opaque-origin popup containment.');
}
if (!authorizeCsp.includes("frame-ancestors 'none'")) {
	throw new Error("/authorize CSP lost frame-ancestors 'none'.");
}

console.log(
	'[verify] Vercel output includes the external-boot Vite shell, external pre-app preview guard, no-store HTML shell, traced server data dependencies, OAuth and Thingtime capability discovery, filesystem route, SPA fallback, injection-resistant strict app CSP, hash-scoped Limitless MCP Lab CSP, scoped design-bundle CSP, and /authorize frame-deny.'
);
