import assert from 'node:assert/strict';
import test from 'node:test';
import { canOfferRecordingHandoff, sendRecordingThingToLopu } from './recordingThingHandoff';
import { buildThingsItemMenu } from '../Things/thingsMenuModel';
import type { ThingsThing } from '../Things/thingsCore';

const recording = { id: 'audio-qa', author: { id: 'owner' }, thingtime: ['attachment'], acl: ['tt:user'],
	targetId: null, crystal: { mediaKind: 'audio' }, tags: [] } as unknown as ThingsThing;
const origin = 'https://thingtime.test';
function fixture({ version = '1.5.0', enabled = true, confirm = true, responseOwner = 'owner' } = {}) {
	let active = 'owner';
	const calls: Array<{ path: string; init?: RequestInit }> = [];
	let confirmations = 0;
	return {
		calls, setOwner: (owner: string) => { active = owner; }, confirmations: () => confirmations,
		options: { origin, activeOwner: () => active,
			confirm: (message: string) => { confirmations++; assert.match(message, /sensitive actions still require confirmation/); return confirm; },
			fetch: (async (path: string, init?: RequestInit) => {
				calls.push({ path, init });
				assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store');
				return Response.json(path.includes('capabilities') ? { origin, features: { 'api.lopu-recordings': { version } } } :
					{ ok: true, ownerId: responseOwner, settings: { enabled } });
			}) as typeof fetch }
	};
}

test('menu offers one owned private audio recording, never foreign/shared/bound/multiple Things', () => {
	assert.equal(canOfferRecordingHandoff(recording, 'owner'), true);
	for (const patch of [{ acl: ['tt:all'] }, { targetId: 'chat-message' }, { crystal: { mediaKind: 'image' } }])
		assert.equal(canOfferRecordingHandoff({ ...recording, ...patch }, 'owner'), false);
	assert.equal(canOfferRecordingHandoff(recording, 'other'), false);
	assert.equal(canOfferRecordingHandoff(recording), false);
	const commands = (count: number) => buildThingsItemMenu({ thing: recording, ownerId: 'owner', actCount: count, clipboardCount: 0 })
		.sections.flatMap((section) => section.actions).map((action) => action.id);
	assert.ok(commands(1).includes('send-to-lopu'));
	assert.ok(!commands(2).includes('send-to-lopu'));
});

test('handoff negotiates, reads consent, confirms, and submits only the selected Thing ID', async () => {
	const f = fixture();
	assert.equal(await sendRecordingThingToLopu(recording, 'owner', f.options), true);
	assert.equal(f.confirmations(), 1);
	assert.equal(f.calls.length, 3);
	assert.deepEqual(JSON.parse(String(f.calls[2].init?.body)), { op: 'send-to-lopu', postId: recording.id });
});

test('cancel never submits or enables processing', async () => {
	const f = fixture({ confirm: false });
	assert.equal(await sendRecordingThingToLopu(recording, 'owner', f.options), false);
	assert.equal(f.calls.length, 2);
	assert.ok(f.calls.every((call) => !call.init?.method));
});

test('old/breaking domains, disabled processors and mismatched accounts stop before confirmation or writes', async () => {
	for (const settings of [{ version: '1.4.0' }, { version: '2.0.0' }, { enabled: false }, { responseOwner: 'other' }]) {
		const f = fixture(settings);
		await assert.rejects(sendRecordingThingToLopu(recording, 'owner', f.options));
		assert.equal(f.confirmations(), 0);
		assert.ok(f.calls.every((call) => !call.init?.method));
	}
});

test('account changes during confirmation stop before mutation', async () => {
	const f = fixture();
	f.options.confirm = () => { f.setOwner('other'); return true; };
	await assert.rejects(sendRecordingThingToLopu(recording, 'owner', f.options), /account changed/);
	assert.equal(f.calls.length, 2);
});
