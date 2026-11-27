import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { characterPrincipal } from '~/api/utils/auth/characterSession';
import { isAdminDoc } from '~/api/utils/auth/admin';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { getRequestMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { changeAutomationSwitches, readAutomationSwitchesStrict } from '~/api/utils/automation/automationSwitchesStore';

// GET|POST /api/v1/admin/automation-switches — the administrator editor for the
// Automation switches. Same session rules as the scheduled job controls: a
// direct, full administrator browser session on home storage. POST body:
// { changes: { "<switch id>": true | false } }. Responses are private/no-store.
function handle(request: Request, write: boolean) {
	return withAdminPrivateResponse(async () => {
		if (request.method !== (write ? 'POST' : 'GET')) return json({ ok: false }, { status: 405 });
		const principal = await characterPrincipal(request);
		if (!principal) return json({ ok: false, error: 'Full administrator session required.' }, { status: 401 });
		const { user, session } = principal;
		if (!isAdminDoc(user) || user.meta?.character || user.accountKind === 'service' || user.meta?.temporary ||
			![undefined, null, 'browser'].includes(session.purpose) || session.meta?.activeCharacterId || request.headers.has('X-Thingtime-Character'))
			return json({ ok: false, error: 'Use a direct administrator session.' }, { status: 403 });
		if (mongoDataPlane(await getRequestMongoEndpoint(request)) !== 'home') return json({ ok: false, error: 'Select Home storage.' }, { status: 409 });
		if (!write) {
			try {
				return json({ ok: true, ...(await readAutomationSwitchesStrict()) });
			} catch {
				return json({ ok: false, error: 'Could not read the automation switches. Try again.' }, { status: 503 });
			}
		}
		if (request.headers.get('X-Thingtime-Expected-Actor') !== String(user._id))
			return json({ ok: false, error: 'Administrator changed. Reload settings.' }, { status: 409 });
		if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (request.headers.has('Origin') && request.headers.get('Origin') !== resolvePublicOrigin(request).origin))
			return json({ ok: false }, { status: 403 });
		const invalidType = requireJsonContentType(request);
		if (invalidType) return invalidType;
		const body: any = await readJsonBody(request, 16 * 1024);
		if (!body || typeof body !== 'object' || Object.keys(body).some((key) => key !== 'changes'))
			return json({ ok: false, error: 'Send { "changes": { "switch id": true | false } }.' }, { status: 400 });
		try {
			return json({ ok: true, ...(await changeAutomationSwitches(body.changes, String(user._id))) });
		} catch (error) {
			if (error instanceof TypeError) return json({ ok: false, error: error.message }, { status: 400 });
			return json({ ok: false, error: 'Could not save the automation switches. Reload and try again.' }, { status: 503 });
		}
	});
}
export const loader = ({ request }: { request: Request }) => handle(request, false);
export const action = ({ request }: { request: Request }) => handle(request, true);
