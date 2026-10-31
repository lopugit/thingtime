import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';

// Copying is a bootstrap operation, never delegated to an unowned program.
// Check the viewer/page boundary on both sides of every asynchronous request.
export async function copyPage(
	input: { id: string; key?: string },
	boundary: { actorId: string; current: () => boolean; signal: AbortSignal },
	ports = { requireCapability: requireThingtimeCapability, fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) }
): Promise<string | null> {
	const current = () => !boundary.signal.aborted && boundary.current();
	if (!current()) return null;
	await ports.requireCapability('api.things-fork', '1.7.0');
	await ports.requireCapability('api.actions-run', '1.7.0'); // shared expected-actor request fence
	if (!current()) return null;
	const response = await ports.fetch('/api/v1/things/fork', {
		method: 'POST',
		credentials: 'same-origin',
		redirect: 'error',
		headers: { 'Content-Type': 'application/json', [EXPECTED_ACTOR_HEADER]: boundary.actorId },
		body: JSON.stringify(input),
		signal: AbortSignal.any([boundary.signal, AbortSignal.timeout(130_000)])
	});
	const data = await response.json();
	if (!current()) return null;
	if (!response.ok || !data?.ok || typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id))
		throw new Error(typeof data?.error === 'string' ? data.error : 'Could not copy this page');
	return `/p/${encodeURIComponent(data.id)}`;
}
