import { SCHEDULED_HTTP_JOBS } from '../api/utils/automation/scheduledJobs';

/**
 * Administrator on/off switches for every automatic, repeating or scheduled
 * piece of Thingtime work: browser polling, desktop folder sync, the Mac
 * Thingtime Node, iPhone and Watch background work, and the server's daily
 * scheduled jobs. One switch per feature, stored together in the
 * `automation-switches` settings singleton.
 *
 * Every switch is OFF unless an administrator turns it on. Missing, unknown,
 * malformed or unreadable values also count as off, so a new client, an outage
 * or a cold cache never starts background traffic by itself. A view still loads
 * its data once when someone opens it; only the repeating refreshes stop.
 *
 * Device-local timers that never touch the network (on-screen clocks, codes,
 * local battery and node status) are not covered: they cost no server work.
 */
export type AutomationSurface = 'web' | 'desktop' | 'mac' | 'iphone' | 'watch' | 'server';

export type AutomationSwitch = {
	id: string;
	surface: AutomationSurface;
	title: string;
	summary: string;
	/** Plain-language list of what stops when the switch is off. */
	covers: readonly string[];
};

export const AUTOMATION_SURFACES: readonly { id: AutomationSurface; title: string }[] = [
	{ id: 'web', title: 'Web app (browsers and desktop app windows)' },
	{ id: 'desktop', title: 'Desktop app' },
	{ id: 'mac', title: 'Mac Thingtime Node' },
	{ id: 'iphone', title: 'iPhone app' },
	{ id: 'watch', title: 'Apple Watch app' },
	{ id: 'server', title: 'Server scheduled jobs' }
];

const CLIENT_SWITCHES: readonly AutomationSwitch[] = [
	{ id: 'web.timeline', surface: 'web', title: 'Timeline and history updates', summary: 'Re-checks timelines and Thing history while they are open.',
		covers: ['Timeline updates', 'Thing history', 'Timeline event browser', 'Timeline branches'] },
	{ id: 'web.notifications', surface: 'web', title: 'Notification badge', summary: 'Re-checks the unread notification count.',
		covers: ['Notification bell count', 'Notification tools'] },
	{ id: 'web.messenger', surface: 'web', title: 'Messenger updates', summary: 'Re-checks chats, open conversations and unread messages.',
		covers: ['Chat list', 'Open conversation', 'New-message toasts'] },
	{ id: 'web.lopu', surface: 'web', title: 'Lopu chat and task updates', summary: 'Re-checks Lopu chats, running tasks, recordings and transcripts.',
		covers: ['Lopu chats and messages', 'Running Lopu tasks', 'Lopu account', 'Recording automation', 'Recording transcripts'] },
	{ id: 'web.feed', surface: 'web', title: 'Feed engagement and view counts', summary: 'Re-checks reactions and sends post view counts in batches.',
		covers: ['Feed engagement', 'Post view tracking'] },
	{ id: 'web.devices', surface: 'web', title: 'Device and Watch status', summary: 'Re-checks the device list, phone connection and Watch approvals.',
		covers: ['Device list', 'Mobile device connection and check-ins', 'Watch pending approvals', 'Widget bridge'] },
	{ id: 'web.admin', surface: 'web', title: 'Admin dashboards', summary: 'Re-checks the CI control dashboard and stack run chat.',
		covers: ['CI control dashboard', 'Stack run chat'] },
	{ id: 'web.statusChecks', surface: 'web', title: 'Service status checks', summary: 'Re-checks the footer health and deployment status.',
		covers: ['Footer service status', 'Deployment status'] },
	{ id: 'web.pageData', surface: 'web', title: 'Page data refresh', summary: 'Re-reads shared page data and embedded Things.',
		covers: ['Signed-in page data', 'Embedded subspace Things'] },
	{ id: 'web.other', surface: 'web', title: 'Other background refreshes', summary: 'Any other repeating browser refresh not listed above.',
		covers: ['New or unlisted browser polling'] },
	{ id: 'desktop.fileSync', surface: 'desktop', title: 'Folder sync', summary: 'Runs folder sync on this computer and shows other devices’ sync status.',
		covers: ['Remote folder sync controls', 'Device sync status', 'Sync resource sampling'] },
	{ id: 'mac.node', surface: 'mac', title: 'Commands and status', summary: 'Checks for remote commands and reports device status.',
		covers: ['Remote command checks', 'Device status and telemetry', 'Location reports'] },
	{ id: 'iphone.notifications', surface: 'iphone', title: 'Notification refresh', summary: 'Refreshes notifications when the app opens.',
		covers: ['Notification refresh on open'] },
	{ id: 'iphone.location', surface: 'iphone', title: 'Location history', summary: 'Records and uploads location history in the background.',
		covers: ['Background location history'] },
	{ id: 'iphone.diagnostics', surface: 'iphone', title: 'Diagnostics retries', summary: 'Retries diagnostic uploads on a timer.',
		covers: ['Automatic diagnostics retries'] },
	{ id: 'watch.pairing', surface: 'watch', title: 'Pairing checks', summary: 'Re-checks a pairing code until it is approved.',
		covers: ['Automatic pairing approval checks'] }
];

export const scheduledJobSwitchId = (jobId: string) => `scheduled.${jobId}`;

const SCHEDULED_SWITCHES: readonly AutomationSwitch[] = SCHEDULED_HTTP_JOBS.map((job) => ({
	id: scheduledJobSwitchId(job.id),
	surface: 'server' as const,
	title: job.name,
	summary: job.weekday === 0 ? 'Runs once each Sunday.' : 'Runs once a day.',
	covers: [job.path]
}));

export const AUTOMATION_SWITCHES: readonly AutomationSwitch[] = [...CLIENT_SWITCHES, ...SCHEDULED_SWITCHES];
export type AutomationSwitchId = string;
export type AutomationSwitchState = Readonly<Record<AutomationSwitchId, boolean>>;

const KNOWN = new Set(AUTOMATION_SWITCHES.map((entry) => entry.id));
export const isAutomationSwitchId = (value: unknown): value is AutomationSwitchId => typeof value === 'string' && KNOWN.has(value);

/** Everything off. */
export const DEFAULT_AUTOMATION_SWITCHES: AutomationSwitchState = Object.freeze(
	Object.fromEntries(AUTOMATION_SWITCHES.map((entry) => [entry.id, false]))
);

/** Keeps only known switches; anything other than literal `true` is off. */
export function normalizeAutomationSwitches(value: unknown): AutomationSwitchState {
	const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	return Object.freeze(Object.fromEntries(AUTOMATION_SWITCHES.map((entry) => [entry.id, source[entry.id] === true])));
}

/** Validates an administrator's `{ id: boolean }` change set. */
export function validateAutomationSwitchChanges(value: unknown):
	| { ok: true; changes: Record<AutomationSwitchId, boolean> }
	| { ok: false; error: string } {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Send changes as { "switch id": true | false }.' };
	const entries = Object.entries(value as Record<string, unknown>);
	if (!entries.length) return { ok: false, error: 'Choose at least one switch to change.' };
	const changes: Record<AutomationSwitchId, boolean> = {};
	for (const [id, enabled] of entries) {
		if (!isAutomationSwitchId(id)) return { ok: false, error: `Unknown automation switch: ${id}` };
		if (typeof enabled !== 'boolean') return { ok: false, error: `${id} must be true or false.` };
		changes[id] = enabled;
	}
	return { ok: true, changes };
}

// Browser activity ids (activityManager) and refresh keys (backgroundRefresh)
// map to the switch that owns them. Unlisted network polling falls under
// `web.other`, so a new poller is still covered by a switch.
const ACTIVITY_PREFIXES: readonly [string, AutomationSwitchId][] = [
	['timer:timeline/', 'web.timeline'],
	['timer:components/Timeline/', 'web.timeline'],
	['timer:components/Nav/NotificationsBell', 'web.notifications'],
	['timer:components/Settings/NotificationTools', 'web.notifications'],
	['timer:components/Messenger/', 'web.messenger'],
	['messenger-', 'web.messenger'],
	['timer:components/Lopu/', 'web.lopu'],
	['timer:components/Attachments/RecordingTranscript', 'web.lopu'],
	['lopu-', 'web.lopu'],
	['timer:components/Feed/', 'web.feed'],
	['timer:components/Devices/', 'web.devices'],
	['timer:components/Watch/', 'web.devices'],
	['timer:components/NativeBridge/', 'web.devices'],
	['timer:components/Admin/', 'web.admin'],
	['timer:components/Status/', 'web.statusChecks'],
	['timer:components/Footer/', 'web.statusChecks'],
	['root-data', 'web.pageData'],
	['subspace-embeds:', 'web.pageData'],
	['sync.remote-control', 'desktop.fileSync'],
	['remote-device-status', 'desktop.fileSync'],
	['sync.resources', 'desktop.fileSync']
];

export function automationSwitchFor(activityId: string): AutomationSwitchId {
	for (const [prefix, id] of ACTIVITY_PREFIXES) if (activityId.startsWith(prefix)) return id;
	return 'web.other';
}

export function automationSwitchOn(state: AutomationSwitchState | null | undefined, id: AutomationSwitchId): boolean {
	return state?.[id] === true;
}
