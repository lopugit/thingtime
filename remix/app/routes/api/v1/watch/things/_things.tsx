import { json, readJsonBody } from '~/api/http';
import {
	attachmentIdForRequest,
	createReadyAttachmentPostInsertHook,
	inspectReadyAttachmentsForPost
} from '~/api/utils/attachments/attachments';
import { getHomeThingsCollection } from '~/api/utils/mongodb/collections';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { createThing, toPublicPosts, viewerOf } from '~/api/utils/things/things';
import { recordWatchSync, resolveWatchDevice } from '~/api/utils/watch/watchPairing';

const MAX_BODY_BYTES = 768 * 1024;
const noStore = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: noStore });
	const context = await resolveWatchDevice(request, 'watch.things.create');
	if (!context) return json({ ok: false, error: 'Unauthorized Watch credential' }, { status: 401, headers: noStore });
	const limit = await enforceRateLimit(request, 'things.write', `device:${context.actor.sessionId}`);
	if (!limit.allowed) {
		const init = rateLimitedResponseInit(limit);
		return json(
			{ ok: false, error: 'The Watch is creating Things too quickly' },
			{ ...init, headers: { ...(init.headers || {}), ...noStore } }
		);
	}
	const body = await readJsonBody(request, MAX_BODY_BYTES);
	const shareId = typeof body?.shareId === 'string' ? body.shareId.trim().slice(0, 160) : '';
	if (!/^watch-upload-[A-Za-z0-9_-]{1,128}$/.test(shareId)) {
		return json({ ok: false, error: 'A stable Watch upload id is required' }, { status: 400, headers: noStore });
	}
	const existing = await (await getHomeThingsCollection()).findOne({
		shareId,
		ownerId: context.user.id,
		thingtime: 'post',
		sourceDeviceId: context.actor.deviceId
	} as any);
	if (existing) {
		await recordWatchSync(context.actor, { status: 'healthy' });
		return json({ ok: true, idempotent: true, post: (await toPublicPosts([existing as any], viewerOf(context.user)))[0] }, { headers: noStore });
	}
	const rawAttachmentIds = Array.isArray(body?.attachmentIds) ? body.attachmentIds : [];
	const rawRequestIds = Array.isArray(body?.requestIds) ? body.requestIds : [];
	if (rawRequestIds.some((value: unknown) => typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))) {
		return json({ ok: false, error: 'Watch upload request ids are invalid' }, { status: 400, headers: noStore });
	}
	const requestIds = rawRequestIds as string[];
	if ((rawAttachmentIds.length > 0) === (requestIds.length > 0)) {
		return json({ ok: false, error: 'Provide attachmentIds or requestIds, but not both' }, { status: 400, headers: noStore });
	}
	const attachmentIds = requestIds.length
		? requestIds.map((requestId: string) => attachmentIdForRequest(context.user.id, requestId))
		: rawAttachmentIds;
	if (!attachmentIds.length || attachmentIds.length > 10) {
		return json({ ok: false, error: 'Choose between 1 and 10 completed attachments' }, { status: 400, headers: noStore });
	}
	const inspected = await inspectReadyAttachmentsForPost(context.user.id, attachmentIds);
	if (inspected.ok === false) return json(inspected, { status: inspected.status, headers: noStore });
	const filenames = Array.isArray(body?.filenames)
		? body.filenames.filter((value: unknown): value is string => typeof value === 'string').map((value: string) => value.trim()).filter(Boolean)
		: [];
	const label = filenames.length ? filenames.join(', ').slice(0, 300) : 'Apple Watch attachment';
	const viewer = viewerOf(context.user);
	const result = await createThing(
		context.user.id,
		{
			shareId,
			thingtime: ['post'],
			crystal: { type: 'text', text: `Uploaded from Apple Watch: ${label}` },
			acl: ['tt:user'],
			tags: ['apple-watch', 'attachment']
		},
		viewer,
		null,
		{
			postAttachments: { hasAny: inspected.hasAny, hasVisual: inspected.hasVisual },
			afterInsert: createReadyAttachmentPostInsertHook(attachmentIds as string[]),
			sourceDeviceId: context.actor.deviceId
		}
	);
	if (result.ok === false) {
		if (result.status === 409 && shareId) {
			const existing = await (await getHomeThingsCollection()).findOne({
				shareId,
				ownerId: context.user.id,
				thingtime: 'post',
				sourceDeviceId: context.actor.deviceId
			} as any);
			if (existing) {
				await recordWatchSync(context.actor, { status: 'healthy' });
				return json({ ok: true, idempotent: true, post: (await toPublicPosts([existing as any], viewer))[0] }, { headers: noStore });
			}
		}
		return json(result, { status: result.status, headers: noStore });
	}
	await recordWatchSync(context.actor, { status: 'healthy' });
	return json({ ok: true, post: (await toPublicPosts([result.doc], viewer))[0] }, { status: 201, headers: noStore });
};

export const loader = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...noStore, Allow: 'POST' } });
