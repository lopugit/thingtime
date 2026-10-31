// Explicit local-only fixture server. Never included in Nitro routes or production.
// Serves the real worker and React gallery through the existing Vite dev stack.
import http from 'node:http';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const port = Number(process.env.MEDIA_QA_PORT || 13543);
const vitePort = Number(process.env.TT_WEB_PORT || 13540);
const image = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#83bdc7' } })
	.composite([
		{
			input: Buffer.from(
				'<svg width="1200" height="800"><circle cx="340" cy="350" r="220" fill="#ffdf81"/><path d="M0 800L750 180L1200 800" fill="#395465"/></svg>'
			)
		}
	])
	.png()
	.toBuffer();
let authorized = true;
let byteRequests = 0;
let validations = 0;
const server = http.createServer(async (req, res) => {
	const origin = `http://localhost:${port}`;
	const url = new URL(req.url, origin);
	const json = (data) => {
		res.setHeader('Content-Type', 'application/json');
		res.setHeader('Cache-Control', 'no-store');
		res.end(JSON.stringify(data));
	};
	if (url.pathname === '/.well-known/thingtime-capabilities.json')
		return json({ schemaVersion: 1, origin, features: { 'api.attachment-content': { version: '1.1.0' } } });
	if (url.pathname === '/fixture-status') return json({ authorized, byteRequests, validations });
	if (url.pathname === '/fixture-access' && req.method === 'POST') {
		authorized = url.searchParams.get('allow') === '1';
		return json({ authorized });
	}
	if (url.pathname === '/api/v1/attachments/content') {
		if (!authorized) {
			res.statusCode = 404;
			return json({ ok: false });
		}
		const width = Number(url.searchParams.get('width') || 0);
		if (url.searchParams.get('cache') === 'validate') {
			validations++;
			return json({
				ok: true,
				cacheKey: `${createHash('sha256')
					.update(url.searchParams.get('id') || '')
					.digest('hex')}:${width || 'original'}`,
				size: image.length
			});
		}
		byteRequests++;
		const bytes = width
			? await sharp(image)
					.resize({ width, withoutEnlargement: true })
					.webp({ quality: width === 64 ? 35 : 80 })
					.toBuffer()
			: image;
		res.setHeader('Content-Type', width ? 'image/webp' : 'image/png');
		res.setHeader('Cache-Control', 'private, no-cache');
		res.setHeader('Content-Length', bytes.length);
		// Make progressive state observable on first load, never on cache hits.
		setTimeout(() => res.end(bytes), width > 64 ? 1500 : 50);
		return;
	}
	if (url.pathname === '/' || url.pathname === '/tests/media-cache.html') {
		res.setHeader('Content-Type', 'text/html');
		res.end(
			'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>[LC] Media cache verification</title></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/tests/media-cache.tsx"></script></body></html>'
		);
		return;
	}
	const proxy = http.request(
		{ hostname: '127.0.0.1', port: vitePort, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${vitePort}` } },
		(upstream) => {
			res.writeHead(upstream.statusCode, upstream.headers);
			upstream.pipe(res);
		}
	);
	proxy.on('error', () => {
		res.statusCode = 502;
		res.end();
	});
	req.pipe(proxy);
});
server.listen(port, '127.0.0.1', () => console.log(`Media cache QA at http://localhost:${port}/tests/media-cache.html`));
