import { json } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { boundedConnectionInventoryPageSize, decodeConnectionInventoryCursor, readMongoConnectionInventory } from '~/api/utils/mongodb/connectionInventory';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const createMongoConnectionsLoader = (dependencies = { requireAdmin, enforceRateLimit, read: readMongoConnectionInventory }) =>
  async ({ request }: { request: Request }) => withAdminPrivateResponse(async () => {
    const expectedOrigin = request.headers.get('X-Thingtime-Expected-Api-Origin');
    if (expectedOrigin !== null && expectedOrigin !== resolvePublicOrigin(request).origin) return json({ ok: false, error: 'The selected API origin changed.' }, { status: 409 });
    const gate = await dependencies.requireAdmin(request);
    if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
    if (gate.user.accountKind === 'service' || gate.user.temporary === true) return json({ ok: false, error: 'A full first-party administrator account is required.' }, { status: 403 });
    const expectedActor = request.headers.get('X-Thingtime-Expected-Actor');
    if (expectedActor !== null && expectedActor !== gate.user.id) return json({ ok: false, error: 'The active account changed.' }, { status: 409 });
    const params = new URL(request.url).searchParams;
    let cursor;
    try { cursor = decodeConnectionInventoryCursor(params.get('cursor')); }
    catch { return json({ ok: false, error: 'Invalid connection inventory cursor' }, { status: 400 }); }
    const rate = await dependencies.enforceRateLimit(request, 'admin.mongodb.connections', `user:${gate.user.id}`, { failClosed: true });
    if (!rate.allowed) return json({ ok: false, error: 'Connection diagnostics are temporarily rate limited.' }, rateLimitedResponseInit(rate));
    try {
      return json({ ok: true, inventory: await dependencies.read({ cursor, limit: boundedConnectionInventoryPageSize(params.get('limit')) }) });
    } catch {
      return json({ ok: false, error: 'Connection inventory is temporarily unavailable.' }, { status: 503 });
    }
  });
export const loader = createMongoConnectionsLoader();
