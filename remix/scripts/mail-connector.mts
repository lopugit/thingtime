/** Local-only mail adapter for ordinary browsers, which cannot open TCP sockets.
 * Run: THINGTIME_MAIL_ORIGIN=https://thingtime.com THINGTIME_MAIL_TOKEN=<random>
 * npm --prefix remix run mail:connector
 * Credentials arrive per request, stay in memory, and never reach Thingtime cloud.
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fetchMailBatch } from '../app/api/utils/mail/provider';
import { MailError, validateMailAccount } from '../app/mail/model';
export function createMailConnector({
	origin,
	token,
	port = 17879,
	fetchBatch = fetchMailBatch
}: {
	origin: string;
	token: string;
	port?: number;
	fetchBatch?: typeof fetchMailBatch;
}) {
	if (!origin || new URL(origin).origin !== origin || !/^https?:$/.test(new URL(origin).protocol) || token.length < 32)
		throw new Error('Set an exact THINGTIME_MAIL_ORIGIN and a random THINGTIME_MAIL_TOKEN of at least 32 characters.');
	let active = 0;
	const server = createServer(async (request, response) => {
		const headers = {
			'Access-Control-Allow-Origin': origin,
			Vary: 'Origin',
			'Cache-Control': 'no-store',
			'Content-Type': 'application/json',
			'X-Content-Type-Options': 'nosniff'
		};
		const send = (status: number, value: object) => {
			response.writeHead(status, headers);
			response.end(JSON.stringify(value));
		};
		if (request.headers.host !== `127.0.0.1:${port}` || request.headers.origin !== origin) {
			send(403, { ok: false, error: 'This origin is not paired.' });
			return;
		}
		if (request.url !== '/sync') {
			send(404, { ok: false, error: 'Not found.' });
			return;
		}
		if (request.method === 'OPTIONS') {
			response.writeHead(204, {
				...headers,
				'Access-Control-Allow-Methods': 'POST',
				'Access-Control-Allow-Headers': 'Authorization, Content-Type',
				'Access-Control-Allow-Private-Network': 'true',
				'Access-Control-Max-Age': '300'
			});
			response.end();
			return;
		}
		const supplied = Buffer.from(request.headers.authorization || ''),
			expected = Buffer.from(`Bearer ${token}`);
		if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
			send(401, { ok: false, error: 'Pair the local connector in Email settings.' });
			return;
		}
		if (request.method !== 'POST' || !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
			send(415, { ok: false, error: 'Use a JSON POST.' });
			return;
		}
		if (active >= 2) {
			send(429, { ok: false, error: 'The local connector is busy. Retry shortly.' });
			return;
		}
		active++;
		const abort = new AbortController();
		response.on('close', () => abort.abort());
		const timer = setTimeout(() => {
			abort.abort();
			request.destroy();
		}, 50000);
		try {
			let size = 0;
			const chunks: Buffer[] = [];
			for await (const chunk of request) {
				size += chunk.length;
				if (size > 65536) throw new MailError(413, 'Request too large.');
				chunks.push(chunk);
			}
			const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			const account = validateMailAccount(body.account);
			if (!account.sync.local) throw new MailError(403, 'Local sync is disabled for this account.');
			const batch = await fetchBatch(
				account,
				{ protocol: body.protocol, path: body.path, cursor: body.cursor, discover: body.discover === true },
				abort.signal
			);
			send(200, { ok: true, version: 1, ...batch });
		} catch (error) {
			send(error instanceof MailError ? error.status : 502, {
				ok: false,
				error: error instanceof MailError ? error.message : 'Local mail sync failed. Check the server and app password.'
			});
		} finally {
			clearTimeout(timer);
			active--;
		}
	});
	server.requestTimeout = 50000;
	server.headersTimeout = 10000;
	return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	const origin = process.env.THINGTIME_MAIL_ORIGIN || '',
		token = process.env.THINGTIME_MAIL_TOKEN || '';
	createMailConnector({ origin, token }).listen(17879, '127.0.0.1', () =>
		console.info(`Thingtime local mail connector: http://127.0.0.1:17879 (paired with ${origin})`)
	);
}
