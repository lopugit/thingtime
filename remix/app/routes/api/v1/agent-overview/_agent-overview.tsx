import { createHash } from 'node:crypto';
import { json } from '~/api/http';
import { actorCors, actorPat, actorUser, resolveActor, revalidateActor, type Actor } from '~/api/utils/auth/resolveActor';
import { viewerOf } from '~/api/utils/things/things';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { getRequestMongoEndpoint, runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { enforceExpectedDataPlane, mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { readAgentOverview } from '~/api/utils/agents/overview';
import { OverviewError, parseOverviewInput } from '~/api/utils/agents/overviewCore';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization, Origin, x-tt-mongo-url, X-Thingtime-Expected-Data-Plane' };
const actorIdentity = (actor: Actor) => {
	const pat = actorPat(actor);
	// Uses remaining changes during authorization and is not an identity or
	// permission. Keep the actual credential id and all read fences stable.
	return JSON.stringify([actor.kind, actorUser(actor)?.id, pat ? [pat.jti, pat.scopes, pat.onlyCreatedThings, pat.visibility, pat.expiresAt] : null, actor.kind === 'app' ? actor.scope : null]);
};
const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
	if (signal.aborted) { reject(signal.reason); return; }
	const abort = () => { clearTimeout(timer); reject(signal.reason); };
	const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
	signal.addEventListener('abort', abort, { once: true });
});

export function createAgentOverviewHandler(deps = { resolveActor, revalidateActor, enforceRateLimit, readAgentOverview, getRequestMongoEndpoint, runWithMongoEndpoint, enforceExpectedDataPlane, mongoDataPlane }, timing = { intervalMs: 3_000, lifetimeMs: 25_000 }) {
	return async ({ request }: { request: Request }) => {
		let input;
		try { input = parseOverviewInput(new URL(request.url).searchParams); }
		catch (error) { return json({ ok: false, error: error instanceof OverviewError ? error.message : 'Invalid overview request' }, { status: 400, headers: PRIVATE_HEADERS }); }
		const credentialRequest = new Request(request.url, { method: 'GET', headers: new Headers(request.headers), signal: request.signal });
		const initial = await deps.resolveActor(credentialRequest, { thingsScope: 'things.read' });
		if (initial instanceof Response) return initial;
		const user = actorUser(initial);
		const headers = { ...PRIVATE_HEADERS, ...actorCors(initial), Vary: PRIVATE_HEADERS.Vary };
		if (!user) return json({ ok: false, error: 'Sign in to read agent tasks' }, { status: 401, headers });
		const admission = await deps.enforceRateLimit(credentialRequest, 'things.search', initial.kind === 'app' ? initial.rateIdentity : `user:${user.id}`, { failClosed: true });
		if (!admission.allowed) return json({ ok: false, error: 'Agent overview is busy. Retry shortly.' }, { ...rateLimitedResponseInit(admission), headers: { ...Object.fromEntries(new Headers(rateLimitedResponseInit(admission).headers)), ...headers } });
		const selected = await deps.getRequestMongoEndpoint(credentialRequest), plane = deps.mongoDataPlane(selected), identity = actorIdentity(initial);
		const lifetime = new AbortController();
		const abort = () => lifetime.abort(request.signal.reason);
		request.signal.addEventListener('abort', abort, { once: true });
		if (request.signal.aborted) abort();
		const authorize = async () => {
			lifetime.signal.throwIfAborted();
			const actor = await deps.revalidateActor(credentialRequest, initial, { thingsScope: 'things.read' });
			if (actor instanceof Response || !actorUser(actor) || actorIdentity(actor) !== identity) throw new OverviewError(403, 'Agent overview access changed. Reopen the page.');
			const endpoint = await deps.getRequestMongoEndpoint(credentialRequest);
			if (deps.enforceExpectedDataPlane(credentialRequest, endpoint) || deps.mongoDataPlane(endpoint) !== plane) throw new OverviewError(409, 'The selected database changed. Reopen the page.');
			return actor;
		};
		const snapshot = async () => {
			const actor = await authorize();
			const result = await deps.runWithMongoEndpoint(selected, () => deps.readAgentOverview(viewerOf(actorUser(actor), actorPat(actor)), input, actor.kind === 'app' ? actor.scope : null, { signal: lifetime.signal }));
			await authorize();
			return result;
		};
		let first;
		try { first = await snapshot(); }
		catch (error) { request.signal.removeEventListener('abort', abort); return json({ ok: false, error: error instanceof OverviewError ? error.message : 'Agent overview is unavailable' }, { status: error instanceof OverviewError ? error.status : 503, headers }); }
		if (new URL(request.url).searchParams.get('stream') !== '1') { request.signal.removeEventListener('abort', abort); return json({ ok: true, result: first }, { headers }); }
		const encoder = new TextEncoder();
		const hash = (value: typeof first) => createHash('sha256').update(JSON.stringify({ ...value, measuredAt: undefined })).digest('hex');
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				void (async () => {
					let previous = hash(first);
					const end = Date.now() + timing.lifetimeMs;
					const timer = setTimeout(() => lifetime.abort(), timing.lifetimeMs);
					try {
						controller.enqueue(encoder.encode('retry: 2000\n\n'));
						send('snapshot', first);
						while (!lifetime.signal.aborted && Date.now() < end) {
							await delay(timing.intervalMs, lifetime.signal);
							const next = await snapshot(), digest = hash(next);
							if (digest !== previous) { previous = digest; send('snapshot', next); }
							else send('heartbeat', { measuredAt: next.measuredAt });
						}
					} catch (error) {
						if (!lifetime.signal.aborted) send(error instanceof OverviewError && [401,403,409].includes(error.status) ? 'forbidden' : 'error', { ok: false, error: error instanceof OverviewError ? error.message : 'Agent overview is reconnecting' });
					} finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); lifetime.abort(); try { controller.close(); } catch { /* canceled reader */ } }
				})();
			},
			cancel() { lifetime.abort(); request.signal.removeEventListener('abort', abort); }
		});
		return new Response(stream, { headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' } });
	};
}
export const loader = createAgentOverviewHandler();
