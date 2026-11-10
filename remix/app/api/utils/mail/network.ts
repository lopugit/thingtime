import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { MailError } from '../../../mail/model';
export function publicMailAddress(address: string): boolean {
	try {
		return ipaddr.process(address).range() === 'unicast';
	} catch {
		return false;
	}
}
/** Resolve once, reject mixed public/private answers, then pin the socket IP. */
export async function resolveMailHost(host: string, signal: AbortSignal, resolver = lookup) {
	signal.throwIfAborted();
	let onAbort: () => void = () => {};
	try {
		const addresses = await Promise.race([
			resolver(host, { all: true, verbatim: true }),
			new Promise<never>((_, reject) => {
				onAbort = () => reject(new MailError(504, 'Mail connection timed out.'));
				signal.addEventListener('abort', onAbort, { once: true });
			})
		]);
		signal.throwIfAborted();
		if (!addresses.length || addresses.some(({ address }) => !publicMailAddress(address)))
			throw new MailError(400, 'Mail servers must resolve only to public internet addresses.');
		return addresses[0];
	} finally {
		signal.removeEventListener('abort', onAbort);
	}
}
