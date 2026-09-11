import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listSavedWaterfalls, saveWaterfall } from '~/api/utils/ai/savedWaterfalls';
const headers = { 'Cache-Control': 'private, no-store' };
export const createSavedWaterfallHandlers = (deps = { user: getCurrentUser, list: listSavedWaterfalls, save: saveWaterfall }) => ({
	loader: async ({ request }: { request: Request }) => {
		const user = await deps.user(request);
		if (!user || user.temporary) return json({ ok: false, error: 'Sign in to manage saved waterfalls.' }, { status: 401, headers });
		if (request.headers.get('x-thingtime-expected-user') !== user.id)
			return json({ ok: false, error: 'Account changed. Reopen the editor.' }, { status: 409, headers });
		return json({ ok: true, waterfalls: await deps.list(user.id) }, { headers });
	},
	action: async ({ request }: { request: Request }) => {
		if (request.method !== 'POST') return json({ ok: false }, { status: 405, headers });
		const user = await deps.user(request);
		if (!user || user.temporary) return json({ ok: false, error: 'Sign in to manage saved waterfalls.' }, { status: 401, headers });
		if (request.headers.get('x-thingtime-expected-user') !== user.id)
			return json({ ok: false, error: 'Account changed. Reopen the editor.' }, { status: 409, headers });
		try {
			const result = await deps.save(user.id, await readJsonBody(request, 160 * 1024));
			return json(result, { status: result.ok === false ? result.status : 200, headers });
		} catch (error) {
			if (error instanceof TypeError) return json({ ok: false, error: error.message }, { status: 400, headers });
			throw error;
		}
	}
});
export const { loader, action } = createSavedWaterfallHandlers();
