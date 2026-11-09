import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { ensureDeviceFolders, readDeviceFolderReference, listDeviceFolderReferences } from '~/api/utils/devices/deviceFolders';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
export const action = async ({ request }: { request: Request }) => {
 if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
 const user = await getCurrentUser(request);
 if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
 if (user.accountKind !== 'user') return json({ ok: false, error: 'Device folders require a full account' }, { status: 403 });
 const limit = await enforceRateLimit(request, 'devices.commands', `user:${user.id}`);
 if (!limit.allowed) return json({ ok: false, error: 'Please retry shortly' }, rateLimitedResponseInit(limit));
 const result = await ensureDeviceFolders(user.id, new URL(request.url).origin, await readJsonBody(request, 128 * 1024), request.signal);
 return json(result, { status: result.ok === false ? result.status : 200, headers: { 'Cache-Control': 'private, no-store' } });
};

export const loader = async ({ request }: { request: Request }) => {
 const user = await getCurrentUser(request);
 if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
 if (user.accountKind !== 'user') return json({ ok: false, error: 'Device folders require a full account' }, { status: 403 });
 const deviceId = new URL(request.url).searchParams.get('deviceId') || '';
 const result = deviceId ? await readDeviceFolderReference(user.id, new URL(request.url).origin, deviceId) : await listDeviceFolderReferences(user.id, new URL(request.url).origin, new URL(request.url).searchParams.get('cursor'));
 return json(result, { status: result.ok === false ? result.status : 200, headers: { 'Cache-Control': 'private, no-store' } });
};
