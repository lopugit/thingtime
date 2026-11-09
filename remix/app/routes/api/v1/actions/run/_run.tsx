import { json, readJsonBody } from '~/api/http';
import { getScopedActor } from '~/api/utils/auth/scopedUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { runAction } from '~/api/utils/actions/execute';
import { getThing, isFail, viewerOf, withFriendIds, withLinkKeys } from '~/api/utils/things/things';
import { resolveSharedComposition } from '~/api/utils/actions/sharedComposition';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { isPrivateActivationPage, parseWebpageActivation, webpageActivationKey } from '~/schemas/webpageActivation';
import { EXPECTED_DATA_PLANE_HEADER, isDataPlane } from '~/utils/dataPlane';

// POST /api/v1/actions/run — execute one action thing inside its declared
// capability + budget envelope. Ordinary runs require a user session. Shared
// runs instead authorize a stored root and execute read-only, without private
// author/visitor account authority or persistent run records.
const MAX_BODY_BYTES = 96 * 1024; // 64KB input ceiling + envelope headroom

export const action = async ({ request }: { request: Request }) => {
	const actor = await getScopedActor(request, 'actions.run');
	const user = actor?.user;
	const limit = await enforceRateLimit(request, 'actions.run', user ? `user:${user.id}` : null);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Actions are running very fast — take a breather ⚡' }, rateLimitedResponseInit(limit));
	}
	const body = await readJsonBody(request, MAX_BODY_BYTES);
	const sharedRoot = body?.sharedRoot;
	if (sharedRoot !== undefined && (typeof sharedRoot !== 'string' || !sharedRoot || sharedRoot.length > 128)) {
		return json({ ok: false, error: 'sharedRoot must be a Thing id' }, { status: 400 });
	}
	if (!user && !sharedRoot) return json({ ok: false, error: 'Sign in to run actions' }, { status: 401 });
	if (body?.source === 'activation') {
		const headers = { 'Cache-Control': 'private, no-store' };
		const refuse = (status: number, error: string) => json({ ok: false, error }, { status, headers });
		if (sharedRoot !== undefined || actor?.kind !== 'account' || !user || user.accountKind !== 'user' || user.temporary || user.isCharacter ||
			request.headers.get(EXPECTED_ACTOR_HEADER) !== user.id || !isSameOriginAttachmentRequest(request))
			return refuse(403, 'Page activation requires your full owning account');
		if (!isDataPlane(request.headers.get(EXPECTED_DATA_PLANE_HEADER))) return refuse(400, 'Page activation requires the expected database');
		if (typeof body.activationPageId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.activationPageId) ||
			typeof body.activationPageRevision !== 'string' || typeof body.activationOnceKey !== 'string' ||
			body.inputs !== undefined || body.key !== undefined)
			return refuse(400, 'Invalid page activation request');
		const viewer = viewerOf(user);
		const getBinding = async () => {
			const page = await getThing(viewer, body.activationPageId);
			if (isFail(page) || page.thing.id !== body.activationPageId || page.thing.author?.id !== user.id || !page.thing.thingtime.includes('webpage') ||
				!isPrivateActivationPage(page.thing.acl) || page.thing.crystal.siteRoute || page.thing.executionHeld)
				return null;
			const binding = parseWebpageActivation(page.thing.crystal.activationAction);
			return binding?.action === body.action && page.thing.updatedAt === body.activationPageRevision ? binding : null;
		};
		const binding = await getBinding();
		if (!binding) return refuse(409, 'The saved page activation is no longer available. Reopen the page.');
		const onceKey = webpageActivationKey(binding);
		if (onceKey !== body.activationOnceKey) return refuse(409, 'The activation date changed. Reopen the page.');
		const getActionRevision = async () => {
			const result = await getThing(viewer, binding.action);
			if (isFail(result) || result.thing.id !== binding.action || result.thing.author?.id !== user.id ||
				!result.thing.thingtime.includes('action') || !isPrivateActivationPage(result.thing.acl) || result.thing.executionHeld)
				return null;
			return result.thing.updatedAt;
		};
		const actionRevision = await getActionRevision();
		if (!actionRevision) return refuse(403, 'Page activation requires your exact private Action');
		request.signal.throwIfAborted();
		const inputs = { ...binding.inputs, ...(binding.dayInput ? { [binding.dayInput]: onceKey } : {}) };
		const result = await runAction(viewer, { action: binding.action, inputs, source: 'activation', execution: body.execution, executionVersion: body.executionVersion }, undefined, {
			firstPartyActorId: user.id, activation: { actionRevision, dayInput: binding.dayInput }, assertAuthorized: async () => {
				request.signal.throwIfAborted();
				const [currentBinding, currentActionRevision] = await Promise.all([getBinding(), getActionRevision()]);
				request.signal.throwIfAborted();
				if (!currentBinding || currentActionRevision !== actionRevision) throw new Error('The saved page activation changed before the Action finished');
			}
		});
		return isFail(result) ? refuse(result.status, result.error) : json(result, { headers });
	}
	const viewer = await withFriendIds(withLinkKeys(user ? viewerOf(user) : null, [typeof body?.key === 'string' ? body.key : '']));
	const shared = sharedRoot ? await resolveSharedComposition(viewer, sharedRoot, { contentRoot: true }) : undefined;
	if (isFail(shared)) return json({ ok: false, error: shared.error }, { status: shared.status });
	const result = await runAction(user ? viewerOf(user) : null, { action: body?.action, inputs: body?.inputs, source: body?.source, execution: body?.execution, executionVersion: body?.executionVersion }, shared, { firstPartyActorId: actor?.kind === 'account' ? user?.id : undefined });
	if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
	return json(result, { headers: { 'Cache-Control': 'private, no-store' } });
};
