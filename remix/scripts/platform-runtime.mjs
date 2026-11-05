import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const platformRuntimePath = new URL('../dist/platform/runtime.js', import.meta.url);
export const platformInlineSource = (code) => code.replace(/<\/script/gi, (match) => match.replace('/', '\\/'));
export const platformScriptHash = (code) => `'sha256-${createHash('sha256').update(platformInlineSource(code)).digest('base64')}'`;
export function readPlatformRuntime() {
	let code, html;
	try {
		code = readFileSync(platformRuntimePath, 'utf8');
		html = readFileSync(new URL('../dist/platform/runtime.html', import.meta.url), 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT')
			throw new Error('Web Platform runtime is missing. Run npm run build:platform before building or serving the app.', { cause: error });
		throw error;
	}
	if (!code.trim() || Buffer.byteLength(code) > 1024 * 1024) throw new Error('Web Platform runtime exceeds its bundle budget');
	if (!html.trim() || Buffer.byteLength(html) > 32 * 1024) throw new Error('Web Platform document exceeds its bundle budget');
	return { code, html, hash: platformScriptHash(code) };
}
export function builtPlatformScriptHash() {
	try {
		return platformScriptHash(readFileSync(platformRuntimePath, 'utf8'));
	} catch (error) {
		if (error.code === 'ENOENT') return null;
		throw error;
	}
}

/** Only build-produced code enters this document. Caller definitions are sent
 * later through the existing validated message protocol, never interpolated. */
export function platformRuntimeDocument({ code, html }, policy) {
	const hash = platformScriptHash(code);
	const directives = policy
		.split(';')
		.map((part) => part.trim())
		.filter((part) => !part.startsWith('sandbox '));
	const script = directives.findIndex((part) => part.startsWith('script-src '));
	if (script < 0) throw new Error('Missing Web Platform script policy');
	directives[script] = `script-src ${hash}`;
	const csp = directives.join('; ').replaceAll('&', '&amp;').replaceAll('"', '&quot;');
	const marker = /<script src="\/platform\/runtime\.js(?:\?v=[a-f0-9]+)?"><\/script>/g;
	if ([...html.matchAll(marker)].length !== 1 || !html.includes('<head>')) throw new Error('Unexpected Web Platform document');
	return html
		.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`)
		.replace(marker, () => `<script>${platformInlineSource(code)}</script>`);
}
