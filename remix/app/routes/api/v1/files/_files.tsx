import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest, withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { readCloudInventory, readCloudPath } from '~/api/utils/files/inventory';
import { streamCloudInventoryPages } from '~/api/utils/files/inventoryPages';
import { cloudInventoryResponse } from '~/api/utils/files/inventoryStream';
import { cloudFolders } from '~/api/utils/files/folders';
import { cloudFiles } from '~/api/utils/files/files';

export const createFilesHandlers = (
	deps: { getUser: typeof getCurrentUser; limit: typeof enforceRateLimit; service: typeof cloudFiles; inventory: typeof readCloudInventory;
		folders: typeof cloudFolders; path?: typeof readCloudPath; pages?: typeof streamCloudInventoryPages } =
		{ getUser: getCurrentUser, limit: enforceRateLimit, service: cloudFiles, inventory: readCloudInventory, folders: cloudFolders, path: readCloudPath }
) => {
	const handle =
		(mutation: boolean) =>
		async ({ request }: { request: Request }) =>
			withAttachmentPrivateResponse(async () => {
				if (request.method !== (mutation ? 'POST' : 'GET')) return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
				if (mutation && !isSameOriginAttachmentRequest(request))
					return json({ ok: false, error: 'Cross-origin file changes are not allowed' }, { status: 403 });
				if (mutation && request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
					return json({ ok: false, error: 'Use application/json' }, { status: 415 });
				const user = await deps.getUser(request);
				if (!user || user.accountKind !== 'user') return json({ ok: false, error: 'A full user session is required' }, { status: 401 });
				const limit = await deps.limit(request, mutation ? 'things.write' : 'attachments.read', `user:${user.id}`, { failClosed: true });
				if (!limit.allowed)
					return json(
						{ ok: false, error: 'File service is unavailable or rate limited' },
						limit.unavailable ? { status: 503 } : rateLimitedResponseInit(limit)
					);
				const url = new URL(request.url);
				if (!mutation && url.searchParams.has('rootId')) {
					if (url.searchParams.has('pages')) {
						if (url.searchParams.getAll('rootId').length !== 1 || url.searchParams.getAll('pages').length !== 1 ||
							url.searchParams.get('pages') !== '1' || [...url.searchParams.keys()].some(key => !['rootId', 'pages'].includes(key)))
							return json({ ok: false, error: 'Use one rootId and pages=1 for streamed inventory' }, { status: 400 });
						return cloudInventoryResponse(user.id, url.searchParams.get('rootId'), request, deps.pages ?? streamCloudInventoryPages);
					}
					if (url.searchParams.getAll('rootId').length !== 1 || url.searchParams.getAll('path').length > 1 ||
						[...url.searchParams.keys()].some((key) => !['rootId', 'path'].includes(key)))
						return json({ ok: false, error: 'Use one rootId alone for inventory, or with one relative path' }, { status: 400 });
					const result = url.searchParams.has('path')
						? await (deps.path ?? readCloudPath)(user.id, url.searchParams.get('rootId'), url.searchParams.get('path'))
						: await deps.inventory(user.id, url.searchParams.get('rootId'));
					return result.ok === false ? json({ ok: false, error: result.error }, { status: result.status }) : json(result);
				}
				if (!mutation && url.searchParams.has('folderId')) {
					if (
						url.searchParams.getAll('folderId').length !== 1 ||
						url.searchParams.getAll('operationId').length > 1 ||
						[...url.searchParams.keys()].some((key) => !['folderId', 'operationId'].includes(key))
					)
						return json({ ok: false, error: 'Use folderId with an optional operationId' }, { status: 400 });
					const result = await deps.folders.read(user.id, url.searchParams.get('folderId'), url.searchParams.get('operationId') ?? undefined);
					return result.ok === false ? json({ ok: false, error: result.error }, { status: result.status }) : json(result);
				}
				if (!mutation && (url.searchParams.getAll('id').length !== 1 || url.searchParams.getAll('operationId').length > 1 ||
					url.searchParams.getAll('kind').length > 1 || [...url.searchParams.keys()].some(key => !['id', 'operationId', 'kind'].includes(key)) ||
					(url.searchParams.has('kind') && (url.searchParams.get('kind') !== 'retained-version' || !url.searchParams.has('operationId')))))
					return json({ ok: false, error: 'Use id with an optional operationId; retained-version requires both' }, { status: 400 });
				const body = mutation ? await readJsonBody(request, 8192) : undefined;
				const result = mutation
					? body?.kind === 'folder'
						? await deps.folders.create(user.id, body)
						: await deps.service.commit(user.id, body)
					: await deps.service.read(user.id, url.searchParams.get('id'), url.searchParams.get('operationId') ?? undefined, url.searchParams.get('kind') === 'retained-version');
				return result.ok === false ? json({ ok: false, error: result.error }, { status: result.status }) : json(result);
			});
	return { loader: handle(false), action: handle(true) };
};
export const { loader, action } = createFilesHandlers();
