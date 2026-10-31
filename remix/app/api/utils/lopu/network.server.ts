import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { isBlockedLopuProviderHostname } from './userVaultCore';
import { parseLopuNetworkRequest } from './networkCore';

export const LOPU_NETWORK_RESPONSE_BYTES = 256 * 1024;
export async function lopuNetworkRequest(raw: unknown, signal?: AbortSignal, deps = { lookup, request }) {
	const input = parseLopuNetworkRequest(raw);
	const url = new URL(input.url);
	const hostname = url.hostname.replace(/^\[|\]$/g, '');
	// Permit public unicast only. Pin the resolved address in the actual socket
	// lookup so a second DNS answer cannot rebind the request into the LAN.
	const publicAddress = (address: string) =>
		!isBlockedLopuProviderHostname(address) &&
		(isIP(address) === 4 ? Number(address.split('.')[0]) < 224 : /^2[0-9a-f]{3}:/i.test(address) && !/^(2001:0:|2002:)/i.test(address));
	if (isBlockedLopuProviderHostname(hostname)) throw new Error('Private network destinations are not allowed.');
	const timeout = AbortSignal.timeout(15_000);
	const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
	abort.throwIfAborted();
	const addresses = isIP(hostname)
		? [{ address: hostname, family: isIP(hostname) }]
		: await Promise.race([
				deps.lookup(hostname, { all: true, verbatim: true }),
				new Promise<never>((_, reject) => abort.addEventListener('abort', () => reject(new Error('DNS lookup timed out.')), { once: true }))
		  ]);
	abort.throwIfAborted();
	if (!addresses.length || addresses.some((item) => !publicAddress(item.address))) throw new Error('The URL must resolve only to public addresses.');
	const selected = addresses[0];
	return new Promise<{ url: string; status: number; contentType: string; body: string }>((resolve, reject) => {
		const req = deps.request(
			url,
			{
				method: input.method,
				headers: { accept: 'text/html, application/json, text/plain, */*', ...input.headers, 'accept-encoding': 'identity' },
				agent: false,
				signal: abort,
				lookup: ((_host: string, options: any, callback: any) =>
					options?.all ? callback(null, [selected]) : callback(null, selected.address, selected.family)) as any
			},
			(response) => {
				// Never follow redirects, forward cookies, or retry ambiguous mutations.
				if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
					response.destroy();
					reject(new Error('Redirect refused. Request the final public URL explicitly.'));
					return;
				}
				const type = String(response.headers['content-type'] || 'text/plain').toLowerCase();
				if (
					!/^(text\/|application\/(json|xml|[^;]+\+json))/.test(type) ||
					(response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
				) {
					response.destroy();
					reject(new Error('Only uncompressed text, HTML, XML and JSON responses are supported.'));
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				response.on('data', (chunk) => {
					size += chunk.length;
					if (size > LOPU_NETWORK_RESPONSE_BYTES) {
						response.destroy(new Error('Response exceeds 256 KiB.'));
						return;
					}
					chunks.push(Buffer.from(chunk));
				});
				response.on('error', reject);
				response.on('end', () =>
					resolve({ url: input.url, status: response.statusCode ?? 0, contentType: type, body: Buffer.concat(chunks).toString('utf8') })
				);
			}
		);
		req.on('error', reject);
		req.end(input.body);
	});
}
