import type { MailAccount } from './model';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
export class MailRequestError extends Error {
	constructor(message: string, public status: number, public actionOutcome?: string) {
		super(message);
	}
}
export async function mailRequest(ownerId: string, body?: Record<string, unknown>, query: Record<string, string> = {}, signal?: AbortSignal) {
	await requireThingtimeCapability(
		'api.mail',
		String(body?.operation || '').startsWith('google-') || (body?.account as MailAccount)?.provider === 'gmail' ? '1.2.0' : '1.1.0'
	);
	const timeout = AbortSignal.timeout(body?.operation === 'sync' || String(body?.operation || '').startsWith('google-') ? 60000 : 15000);
	signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	const params = new URLSearchParams({ ...query, expectedOwnerId: ownerId });
	const response = await fetch(`/api/v1/mail?${params}`, {
		method: body ? 'POST' : 'GET',
		credentials: 'same-origin',
		redirect: 'error',
		cache: 'no-store',
		signal,
		...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, expectedOwnerId: ownerId }) } : {})
	});
	const result = await response.json().catch(() => null);
	if (!response.ok || !result?.ok || result.ownerId !== ownerId)
		throw new MailRequestError(
			result?.error || 'Cloud mail is unavailable. Your device copy is still available.',
			response.status,
			result?.actionOutcome
		);
	return result;
}
export async function localMailRequest(account: MailAccount, token: string, request: Record<string, unknown>, signal: AbortSignal) {
	if (!account.sync.local) throw new Error('Local sync is disabled.');
	if (token.length < 32) throw new Error('Pair the local connector in Email settings.');
	const response = await fetch('http://127.0.0.1:17879/sync', {
		method: 'POST',
		credentials: 'omit',
		redirect: 'error',
		cache: 'no-store',
		signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({ account, ...request })
	});
	const result = await response.json().catch(() => null);
	if (!response.ok || !result?.ok || result.version !== 1) throw new Error(result?.error || 'The local connector is unavailable.');
	return result;
}

/** Explicit relay: account secrets transit the selected Thingtime origin, never a fallback. */
export async function relayMailRequest(ownerId: string, account: MailAccount, request: Record<string, unknown>, signal: AbortSignal) {
	if (!account.sync.local || account.sync.transport !== 'relay') throw new Error('Thingtime API relay is not enabled for this account.');
	await requireThingtimeCapability('api.mail-sync', '1.0.0');
	signal.throwIfAborted();
	const response = await fetch(`/api/v1/mail/sync?${new URLSearchParams({ expectedOwnerId: ownerId })}`, {
		method: 'POST',
		credentials: 'same-origin',
		redirect: 'error',
		cache: 'no-store',
		signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...request, operation: 'relay', expectedOwnerId: ownerId, account })
	});
	const result = await response.json().catch(() => null);
	if (!response.ok || !result?.ok || result.ownerId !== ownerId || result.version !== 1)
		throw new Error(result?.error || 'Thingtime API mail relay is unavailable. Your device copy is still available.');
	return result;
}
