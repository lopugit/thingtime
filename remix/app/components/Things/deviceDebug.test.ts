import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceDebugClient, debugEventDisplay, DebugReadError, parseDebugPage, mergeDebugEvents, type DebugScope } from './deviceDebug.client';
import { DeviceDebugScopeError } from '../../utils/deviceDebugScope';
import { deviceDebugBlocks } from './deviceDebugBlocks';
import { findBlock, collectBlockIds } from '../Builder/webpageBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { resolveBlockProps } from '../Builder/templateBlocks';

const event = { id: 'event-1', eventId: 'ee0ee89e-7e4a-4dca-ab24-b02a4c9f5c75', deviceId: 'iphone-1', occurredAt: '2026-11-12T00:00:00.000Z', receivedAt: '2026-11-12T00:00:01.000Z', category: 'sync', level: 'warning', code: 'sync.waiting', state: 'waiting',
	phase: 'uploading', reason: 'retry', failureOperation: 'parts', retrySource: 'budget', retryAt: '2026-11-12T01:00:00.000Z', counts: { uploadedFiles: 5, uploadedBytes: 8388608 }, runtime: { platform: 'ios', appVersion: '1.0', build: '70' }, systemError: { domain: 'NSURLErrorDomain', code: -1009 } };
const wire = (events: unknown[] = [event]) => ({ ok: true, folder: { id: 'debug-folder', name: 'Debug', hidden: true }, settings: { enabled: true }, throughSequence: 12, events, nextCursor: null });
const scope = (isCurrent = () => true, dataPlane = 'home'): DebugScope => ({ origin: 'https://example.test', ownerId: 'owner-1', dataPlane, isCurrent });
const filters = { deviceId: '', level: '', category: '' };
const signal = () => new AbortController().signal;

test('debug display preserves measured counts, system code, phase, retry and build without inferring completion', () => {
	const page = parseDebugPage(wire());
	const display = debugEventDisplay(page.events[0], 'owner-1');
	assert.match(display.progress, /5 files uploaded/); assert.match(display.progress, /8,388,608 bytes uploaded/);
	assert.equal(display.phaseLabel, 'uploading'); assert.equal(display.operationLabel, 'parts'); assert.equal(display.retrySourceLabel, 'budget');
	assert.match(display.errorLabel, /NSURLErrorDomain · -1009/); assert.match(display.runtimeLabel, /ios · App 1.0 · Build 70/);
	assert.match(display.href, /dataPlane=home/); assert.match(display.href, /historyOwner=owner-1/);
	assert.doesNotMatch(display.stateLine, /complete/);
});

test('only canonical closed fields can be displayed or exported', () => {
	const page = parseDebugPage(wire([{ ...event, message: 'secret raw error', url: 'https://private.example/token', path: '/private/name' }]));
	assert.doesNotMatch(JSON.stringify(page), /secret|private.example|private\/name/);
	for (const bad of [{ code: 'secret-raw-message' }, { runtime: { platform: 'ios', appVersion: 'token=secret' } }, { counts: { filename: 1 } }, { systemError: { domain: 'SecretDomain', code: 1 } }]) assert.throws(() => parseDebugPage(wire([{ ...event, ...bad }])));
});

test('missing capability or non-home scope refuses before a request or write', async () => {
	let requests = 0;
	const transport = { fetch: (async () => { requests++; return Response.json(wire()); }) as typeof fetch, capability: async () => { throw Error('missing contract'); } };
	await assert.rejects(createDeviceDebugClient(scope(), transport).ensure(signal()));
	await assert.rejects(createDeviceDebugClient(scope(() => true, 'custom-' + 'a'.repeat(64)), transport).setEnabled(false, signal()), /home database/);
	assert.equal(requests, 0);
});

test('owner switch while awaiting capability or response refuses stale results', async () => {
	let current = true, requests = 0;
	await assert.rejects(createDeviceDebugClient(scope(() => current), { capability: async () => { current = false; }, fetch: (async () => { requests++; return Response.json(wire()); }) as typeof fetch }).read(filters, signal()), /account or server changed/);
	assert.equal(requests, 0); current = true;
	await assert.rejects(createDeviceDebugClient(scope(() => current), { capability: async () => {}, fetch: (async () => { current = false; return Response.json(wire()); }) as typeof fetch }).read(filters, signal()), /account or server changed/);
});

test('filters and cursor are server-side and owner/home authority is retained on each page', async () => {
	const requests: { input: string; init?: RequestInit }[] = [];
	const client = createDeviceDebugClient(scope(), { capability: async () => {}, fetch: (async (input, init) => { requests.push({ input: String(input), init }); return Response.json(wire()); }) as typeof fetch });
	await client.read({ level: 'error', category: 'upload', deviceId: 'iphone-1' }, signal(), 'opaque&cursor');
	const url = new URL(requests[0].input);
	assert.equal(url.searchParams.get('cursor'), 'opaque&cursor'); assert.equal(url.searchParams.get('level'), 'error'); assert.equal(url.searchParams.get('category'), 'upload'); assert.equal(url.searchParams.get('deviceId'), 'iphone-1');
	const headers = new Headers(requests[0].init?.headers); assert.equal(headers.get('X-Thingtime-Expected-Actor'), 'owner-1'); assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), 'home');
	assert.equal(requests[0].init?.cache, 'no-store'); assert.equal(requests[0].init?.redirect, 'error');
});

test('authorization refusal clears protected content and never displays server error strings', async () => {
	const client = createDeviceDebugClient(scope(), { capability: async () => {}, fetch: (async () => Response.json({ error: 'private-token' }, { status: 403 })) as typeof fetch });
	await assert.rejects(client.read(filters, signal()), (error: unknown) => error instanceof Error && 'clear' in error && error.clear === true && !error.message.includes('private-token'));
});

test('pagination deduplicates overlapping exact event identities without losing pending events', () => {
	const e = parseDebugPage(wire()).events[0];
	assert.deepEqual(mergeDebugEvents([e], [e, { ...e, id: 'event-2' }]).map(v => v.id), ['event-1', 'event-2']);
});

test('a clear continuation sends the original server snapshot and operation identity unchanged', async () => {
	const requests: Record<string, unknown>[] = [];
	const id = 'ee0ee89e-7e4a-4dca-ab24-b02a4c9f5c75';
	const client = createDeviceDebugClient(scope(), { capability: async () => {}, fetch: (async (_input, init) => {
		const body = JSON.parse(String(init?.body)); requests.push(body);
		return Response.json({ ok: true, requestId: id, throughSequence: 12, deleted: 5, hasMore: requests.length === 1 });
	}) as typeof fetch });
	assert.equal((await client.clear(id, 12, signal())).hasMore, true);
	assert.equal((await client.clear(id, 12, signal())).hasMore, false);
	assert.deepEqual(requests, [{ action: 'clear', requestId: id, throughSequence: 12 }, { action: 'clear', requestId: id, throughSequence: 12 }]);
	await assert.rejects(client.clear(id, 13, signal()), /could not be confirmed/);
});

test('canonical authenticated transport is used for requests without exposing its session to view data', async () => {
	const calls: unknown[] = [];
	const client = createDeviceDebugClient(scope(), { request: async (query, body) => { calls.push({ query, body }); return wire(); } });
	assert.equal((await client.read(filters, signal())).events.length, 1);
	assert.equal(calls.length, 1);
	assert.doesNotMatch(JSON.stringify(calls), /authorization|cookie|bearer/i);
});

test('a scope refusal after a successful result retires protected rows rather than treating it as offline data', async () => {
	for (const refusal of [new DebugReadError(true, 'Selected server changed'), new DeviceDebugScopeError()]) {
		let fail = false;
		const client = createDeviceDebugClient(scope(), { request: async () => { if (fail) throw refusal; return wire(); } });
		let visible = (await client.read(filters, signal())).events;
		assert.equal(visible.length, 1); fail = true;
		try { await client.read(filters, signal()); assert.fail('scope refusal required'); }
		catch (cause) { assert.ok(cause instanceof DebugReadError); assert.equal(cause.clear, true); if (cause.clear) visible = []; }
		assert.equal(visible.length, 0);
	}
});

test('every repeated event field, filter and control survives the canonical editable block codec', () => {
	const blocks = settingsDocumentBlocks(deviceDebugBlocks);
	for (const id of ['debug-title', 'debug-level-input', 'debug-category-input', 'debug-device-input', 'debug-event-title', 'debug-event-time', 'debug-event-progress', 'debug-event-summary', 'debug-field-runtime', 'debug-field-reason', 'debug-field-system', 'debug-field-retry', 'debug-event-open', 'debug-capture', 'debug-clear', 'debug-export']) assert.ok(findBlock(blocks, id), id);
	const ids = collectBlockIds(blocks); assert.ok(ids.size > 60);
	const props = resolveBlockProps(findBlock(blocks, 'debug-event-open')!.props!, { item: { href: '/thing/event-1?dataPlane=home' } }); assert.equal(props.href, '/thing/event-1?dataPlane=home');
	assert.ok(!JSON.stringify(blocks).includes('iphone-1'));
});
