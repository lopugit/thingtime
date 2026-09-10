import type { ThingsThing } from '../Things/thingsCore';
import { supportsSavedRecordings } from './recordingsCapabilities';

// A menu hint, not authorization. The API rechecks protected purpose/state,
// ownership and binding because those fields are deliberately not public.
export const canOfferRecordingHandoff = (thing: ThingsThing, ownerId?: string | null) =>
	!!ownerId && thing.author?.id === ownerId && /^[A-Za-z0-9_-]{1,160}$/.test(thing.id) &&
	thing.acl?.length === 1 && thing.acl[0] === 'tt:user' && (
		(thing.thingtime.length === 1 && thing.thingtime[0] === 'attachment' &&
			thing.targetId == null && thing.crystal?.mediaKind === 'audio') ||
		(thing.thingtime.includes('post') && !thing.thingtime.includes('comment') &&
			thing.tags?.includes('apple-watch') && thing.id.startsWith('watch-upload-'))
	);

export async function sendRecordingThingToLopu(thing: ThingsThing, ownerId: string, options: {
	origin: string;
	activeOwner: () => string | undefined;
	confirm: (message: string) => boolean;
	fetch: typeof fetch;
}) {
	const assertOwner = () => {
		if (options.activeOwner() !== ownerId || !canOfferRecordingHandoff(thing, ownerId))
			throw new Error('Your account changed. Select your own private recording again.');
	};
	const request = async (path: string, body?: unknown) => {
		assertOwner();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 20_000);
		try {
			const response = await options.fetch(path, {
				credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
				...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
			});
			assertOwner();
			const result = await response.json();
			assertOwner();
			if (!response.ok || result.ok === false) throw new Error(result.error || 'The recording could not be sent. Check recording activity before retrying.');
			return result;
		} finally { clearTimeout(timer); }
	};
	const manifest = await request('/.well-known/thingtime-capabilities.json');
	if (!supportsSavedRecordings(manifest, options.origin)) throw new Error('Send to Lopu for saved recordings is not available on this domain yet.');
	const settings = await request('/api/v1/lopu/recordings');
	if (settings.ownerId !== ownerId) throw new Error('Your account changed. Select your recording again.');
	if (!settings.settings?.enabled) throw new Error('Choose and enable a recording processor in Recording settings first.');
	if (!options.confirm('Send this recording’s transcript to Lopu to act on its instructions? Lopu may create Things and reminders. Other sensitive actions still require confirmation in the conversation.')) return false;
	assertOwner();
	const result = await request('/api/v1/lopu/recordings', { op: 'send-to-lopu', postId: thing.id });
	if (result.ownerId !== ownerId) throw new Error('Your account changed. Check Recording activity before retrying.');
	return true;
}
