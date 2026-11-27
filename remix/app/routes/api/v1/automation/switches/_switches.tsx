import { json } from '~/api/http';
import { readAutomationSwitches } from '~/api/utils/automation/automationSwitchesStore';

// GET /api/v1/automation/switches — public, non-secret on/off state of every
// automatic background feature. Browsers, the desktop app, the Mac Thingtime
// Node, iPhone and Watch read it once at start (and on return to the app) to
// decide whether to poll. The CDN caches it for a few minutes so these reads
// rarely reach a function; administrators see changes immediately through the
// private admin endpoint, and clients pick them up within the cache window.
export const AUTOMATION_SWITCHES_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

export const createAutomationSwitchesLoader = (read: typeof readAutomationSwitches) => async ({ request }: { request: Request }) => {
	if (request.method !== 'GET' && request.method !== 'HEAD')
		return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } });
	const { switches, updatedAt } = await read();
	return json({ ok: true, switches, updatedAt }, { headers: { 'Cache-Control': AUTOMATION_SWITCHES_CACHE_CONTROL } });
};

export const loader = createAutomationSwitchesLoader(readAutomationSwitches);
