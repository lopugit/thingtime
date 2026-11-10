import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { SecureWriteContendedError, getUserHistoryPrefs, setUserHistoryPrefs } from '~/api/utils/auth/users';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { HISTORY_PAUSED_THINGS_MAX, parseHistoryPrefsPatch } from '~/timeline/historyPrefs';

// GET/POST /api/v1/timeline/settings — the account's history preferences
// (api.timeline-settings 1.0.0; never inside _timeline.tsx, so api.timeline
// stays pinned). The preference is account-level: no ownerId/dataPlane fence
// here (the catch-all's enforceExpectedActor applies when the client sends
// X-Thingtime-Expected-Actor), and the store is home-pinned by construction
// (users.ts createHistoryPrefsStore), so a selected data source changes nothing.
const privateHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization, x-tt-mongo-url' };
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => json(body, { status, headers: { ...privateHeaders, ...headers } });
// 200 ids × 200 chars does not fit the notifications route's 16 KiB cap.
export const TIMELINE_SETTINGS_BODY_MAX_BYTES = 64 * 1024;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const defaults = { user: getCurrentUser, limit: enforceRateLimit, get: getUserHistoryPrefs, set: setUserHistoryPrefs };

export function createTimelineSettingsHandlers(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	const authorize = async (request: Request, key: 'timeline.read' | 'timeline.settings') => {
		const user = await deps.user(request);
		if (!user || user.temporary || user.accountKind !== 'user') return response({ ok: false, error: 'Sign in with a full account to manage history settings.' }, 401);
		const limit = await deps.limit(request, key, `user:${user.id}`, { failClosed: true });
		if (!limit.allowed) return json({ ok: false, error: 'History settings are busy; retry shortly' }, { ...rateLimitedResponseInit(limit), headers: { ...privateHeaders, ...Object.fromEntries(new Headers(rateLimitedResponseInit(limit).headers)) } });
		return user;
	};
	const loader = async ({ request }: { request: Request }) => {
		const user = await authorize(request, 'timeline.read');
		if (user instanceof Response) return user;
		return response({ ok: true, prefs: await deps.get(user.id) });
	};
	const action = async ({ request }: { request: Request }) => {
		if (request.method !== 'POST') return response({ ok: false, error: 'Method not allowed' }, 405);
		const user = await authorize(request, 'timeline.settings');
		if (user instanceof Response) return user;
		let patch;
		try {
			const body = await readJsonBody(request, TIMELINE_SETTINGS_BODY_MAX_BYTES);
			if (!object(body) || Object.keys(body).some(key => key !== 'prefs')) throw new TypeError('Body must be { prefs }');
			patch = parseHistoryPrefsPatch(body.prefs);
		} catch (error) {
			if (error instanceof Response) return response({ ok: false, error: 'History settings request is too large' }, error.status);
			return response({ ok: false, error: error instanceof TypeError ? error.message : 'Invalid history settings request' }, 400);
		}
		try {
			const result = await deps.set(user.id, patch);
			// The full stored record, never an echo of the patch: pause/resume are deltas.
			return result.matched ? response({ ok: true, prefs: result.prefs }) : response({ ok: false, error: 'Account not found' }, 404);
		} catch (error) {
			if (error instanceof RangeError) return response({ ok: false, error: `Too many paused Things (max ${HISTORY_PAUSED_THINGS_MAX})` }, 400);
			if (error instanceof SecureWriteContendedError) return response({ ok: false, error: 'History settings are busy; retry shortly' }, 503, { 'Retry-After': '1' });
			throw error;
		}
	};
	return { loader, action };
}

export const { loader, action } = createTimelineSettingsHandlers();
