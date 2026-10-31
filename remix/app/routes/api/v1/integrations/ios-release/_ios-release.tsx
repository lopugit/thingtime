import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { authorizeIOSRelease, parseIOSReleaseBundle } from '~/api/utils/releases/iosReleaseCore';
import * as release from '~/api/utils/releases/iosRelease';

export const createIOSReleaseAction = (deps = release, production = () => process.env.VERCEL_ENV === 'production') =>
  ({ request }: { request: Request }) => withAdminPrivateResponse(async () => {
    const fail = (status: number, error: string) => json({ ok: false, error }, { status });
    if (request.method !== 'POST') return fail(405, 'Use POST.');
    // Preview deployments may share bootstrap/database settings; never deliver production signing material there.
    if (!production()) return fail(503, 'iOS release delivery is available only on production.');
    const authorization = request.headers.get('authorization') ?? '';
    if (!/^Bearer [A-Za-z0-9_.-]{100,16000}$/.test(authorization)) return fail(401, 'GitHub release identity required.');
    try {
      let identity;
      try { identity = await deps.verifyIOSReleaseToken(authorization.slice(7)); }
      catch { return fail(403, 'Invalid or expired GitHub release identity.'); }
      const policy = await deps.readIOSReleasePolicy();
      if (!policy) return fail(503, 'iOS release policy is not configured or is disabled.');
      if (!authorizeIOSRelease(identity, policy)) return fail(403, 'This workflow is not authorized for iOS releases.');
      const body = await readJsonBody(request, 32 * 1024);
      if (!body || !['fetch', 'migrate'].includes(body.operation) ||
          Object.keys(body).some((key) => !['operation', 'credentials'].includes(key))) return fail(400, 'Invalid release operation.');
      if (body.operation === 'migrate' && (!policy.allowMigration || identity.event_name !== 'workflow_dispatch')) return fail(403, 'Credential migration is not enabled.');
      const candidate = body.operation === 'migrate' ? parseIOSReleaseBundle(body.credentials) : null;
      if (body.operation === 'migrate' && !candidate) return fail(400, 'Invalid Apple release bundle.');
      if (body.operation === 'fetch' && body.credentials !== undefined) return fail(400, 'Fetch does not accept credentials.');
      if (!await deps.claimIOSReleaseToken(identity.jti!, identity.exp!)) return fail(409, 'Release identity has already been used.');
      const current = await deps.readIOSReleasePolicy();
      if (!current || !authorizeIOSRelease(identity, current) || (candidate && !current.allowMigration)) return fail(403, 'Release policy changed.');
      // Audit must succeed before returning any secret. Never record tokens or bundle values.
      if (candidate) {
        const imported = await deps.migrateIOSReleaseCredentials(candidate);
        await deps.auditIOSRelease(String(identity.run_id), 'migrate', String(identity.sha));
        return json({ ok: true, imported });
      }
      const credentials = parseIOSReleaseBundle(await deps.readIOSReleaseCredentials());
      if (!credentials) return fail(503, 'Apple release credentials are missing or invalid.');
      await deps.auditIOSRelease(String(identity.run_id), 'fetch', String(identity.sha));
      return json({ ok: true, credentials });
    } catch (error) {
      if (error instanceof Response) throw error;
      return fail(503, 'iOS release vault is unavailable.');
    }
  });
export const action = createIOSReleaseAction();
