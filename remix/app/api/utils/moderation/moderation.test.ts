import assert from 'node:assert/strict';
import test from 'node:test';

import { toAttachmentPublicMetadata } from '../attachments/attachmentCore';
import { createAnalyzeReadyAttachment, moderationFlagShareId, MODERATION_FLAG_THINGTIME } from './analyzeAttachment';
import {
	attachmentIsBlocked,
	attachmentIsNsfw,
	attachmentModerationStatus,
	moderationFromVerdict,
	sanitizeModerationCategories
} from './moderationCore';
import { resolveModerationProvider, testModerationProvider } from './providers';

const NOW = new Date('2026-08-18T00:00:00.000Z');

test('moderationFromVerdict maps verdicts with tosViolation outranking nsfw', () => {
	const blocked = moderationFromVerdict({ nsfw: true, tosViolation: true, categories: ['csam'], reason: 'r' }, { provider: 'test', now: NOW });
	assert.equal(blocked.status, 'blocked');
	const nsfw = moderationFromVerdict({ nsfw: true, tosViolation: false, categories: ['explicit-nudity'] }, { provider: 'test', now: NOW });
	assert.equal(nsfw.status, 'nsfw');
	const clear = moderationFromVerdict({ nsfw: false, tosViolation: false, categories: [] }, { provider: 'test', model: 'm', now: NOW });
	assert.equal(clear.status, 'clear');
	assert.equal(clear.model, 'm');
	assert.equal(clear.analyzedAt, NOW);
});

test('sanitizeModerationCategories bounds, lowercases, and truncates provider output', () => {
	const flood = Array.from({ length: 100 }, (_, index) => `  Category-${index}${'x'.repeat(100)}`);
	const clean = sanitizeModerationCategories(flood);
	assert.equal(clean.length, 12);
	assert.ok(clean.every((entry) => entry.length <= 48 && entry === entry.toLowerCase()));
	assert.deepEqual(sanitizeModerationCategories('not-an-array'), []);
	assert.deepEqual(sanitizeModerationCategories([1, null, '', 'ok']), ['ok']);
});

test('moderation doc guards read only well-formed stamps', () => {
	assert.equal(attachmentModerationStatus({ moderation: { status: 'nsfw' } }), 'nsfw');
	assert.equal(attachmentModerationStatus({ moderation: { status: 'bogus' } }), null);
	assert.equal(attachmentModerationStatus({}), null);
	assert.equal(attachmentIsBlocked({ moderation: { status: 'blocked' } }), true);
	assert.equal(attachmentIsBlocked({ moderation: { status: 'nsfw' } }), false);
	assert.equal(attachmentIsNsfw({ moderation: { status: 'nsfw' } }), true);
});

test('public metadata carries nsfw and drops blocked attachments entirely', () => {
	const crystal = { name: 'a.png', size: 10, contentType: 'image/png', mediaKind: 'image' };
	assert.deepEqual(toAttachmentPublicMetadata('id-1', crystal), { id: 'id-1', ...crystal });
	assert.deepEqual(toAttachmentPublicMetadata('id-1', crystal, { status: 'clear' }), { id: 'id-1', ...crystal });
	assert.deepEqual(toAttachmentPublicMetadata('id-1', crystal, { status: 'nsfw' }), { id: 'id-1', ...crystal, nsfw: true });
	assert.equal(toAttachmentPublicMetadata('id-1', crystal, { status: 'blocked' }), null);
	// malformed moderation input never crashes or leaks a flag
	assert.deepEqual(toAttachmentPublicMetadata('id-1', crystal, 'garbage'), { id: 'id-1', ...crystal });
});

test('test provider keys verdicts off filename markers', async () => {
	const base = { bytes: new Uint8Array([1]), contentType: 'image/png' };
	const nsfw = await testModerationProvider.analyzeImage({ ...base, filename: 'holiday-tt-test-nsfw.png' });
	assert.deepEqual({ nsfw: nsfw.nsfw, tos: nsfw.tosViolation }, { nsfw: true, tos: false });
	const tos = await testModerationProvider.analyzeImage({ ...base, filename: 'TT-Test-Illegal-thing.png' });
	assert.equal(tos.tosViolation, true);
	const clear = await testModerationProvider.analyzeImage({ ...base, filename: 'cat.png' });
	assert.deepEqual({ nsfw: clear.nsfw, tos: clear.tosViolation }, { nsfw: false, tos: false });
});

test('provider resolution follows THINGTIME_MODERATION_PROVIDER and fails to off without a key', async () => {
	assert.equal((await resolveModerationProvider({} as any)).kind, 'off');
	assert.equal((await resolveModerationProvider({ THINGTIME_MODERATION_PROVIDER: 'off', ANTHROPIC_API_KEY: 'k' } as any)).kind, 'off');
	const testChoice = await resolveModerationProvider({ THINGTIME_MODERATION_PROVIDER: 'test' } as any);
	assert.equal(testChoice.kind === 'provider' && testChoice.provider.name, 'test');
	const claudeChoice = await resolveModerationProvider({ THINGTIME_MODERATION_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'test-key' } as any);
	assert.equal(claudeChoice.kind === 'provider' && claudeChoice.provider.name, 'claude');
	const implicit = await resolveModerationProvider({ ANTHROPIC_API_KEY: 'test-key' } as any);
	assert.equal(implicit.kind === 'provider' && implicit.provider.name, 'claude');
});

type FakeCollectionState = {
	doc: any;
	updates: Array<{ filter: any; update: any; options?: any }>;
};

const fakeThings = (state: FakeCollectionState) => ({
	findOne: async (filter: any) => (filter.shareId === state.doc?.shareId ? state.doc : null),
	updateOne: async (filter: any, update: any, options?: any) => {
		state.updates.push({ filter, update, options });
		return { modifiedCount: 1, matchedCount: 1 };
	}
});

const readyImageDoc = (overrides: Record<string, unknown> = {}) => ({
	shareId: 'attachment-1',
	thingtime: ['attachment'],
	ownerId: 'user-1',
	attachmentState: 'ready',
	attachmentPurpose: 'post',
	objectKey: 'objects/attachment-1',
	objectVersionId: 'v1',
	crystal: { name: 'pic.png', size: 1024, contentType: 'image/png', mediaKind: 'image' },
	...overrides
});

const analyzerWith = (state: FakeCollectionState, verdict: { nsfw: boolean; tosViolation: boolean }, options: { failProvider?: boolean } = {}) =>
	createAnalyzeReadyAttachment({
		getThings: (async () => fakeThings(state)) as any,
		getS3: () => ({ signDownload: async () => ({ url: 'https://s3.example/signed', expiresAt: NOW.toISOString() }) }) as any,
		resolveProvider: async () => ({
			kind: 'provider',
			provider: {
				name: 'test',
				model: 'test-model',
				analyzeImage: async () => {
					if (options.failProvider) throw new Error('provider down');
					return { ...verdict, categories: ['cat'], reason: 'why' };
				}
			}
		}),
		fetchBytes: async () => new Uint8Array([1, 2, 3]),
		now: () => NOW
	});

const lastModerationStamp = (state: FakeCollectionState) =>
	[...state.updates].reverse().find((entry) => entry.update?.$set?.moderation)?.update.$set.moderation;

test('analyzer stamps nsfw verdicts and logs a moderation flag', async () => {
	const state: FakeCollectionState = { doc: readyImageDoc(), updates: [] };
	const result = await analyzerWith(state, { nsfw: true, tosViolation: false })('attachment-1');
	assert.deepEqual(result, { ok: true, status: 'nsfw' });
	const stamp = lastModerationStamp(state);
	assert.equal(stamp.status, 'nsfw');
	assert.equal(stamp.provider, 'test');
	const flag = state.updates.find((entry) => entry.filter?.shareId === moderationFlagShareId('attachment-1'));
	assert.ok(flag, 'flag upsert recorded');
	assert.equal(flag!.options?.upsert, true);
	assert.deepEqual(flag!.update.$set.thingtime, [MODERATION_FLAG_THINGTIME]);
});

test('analyzer quarantines TOS verdicts as blocked', async () => {
	const state: FakeCollectionState = { doc: readyImageDoc(), updates: [] };
	const result = await analyzerWith(state, { nsfw: false, tosViolation: true })('attachment-1');
	assert.deepEqual(result, { ok: true, status: 'blocked' });
	assert.equal(lastModerationStamp(state).status, 'blocked');
	assert.ok(state.updates.some((entry) => entry.filter?.shareId === moderationFlagShareId('attachment-1')));
});

test('analyzer skips non-analyzable media and the off provider without fetching bytes', async () => {
	const fileState: FakeCollectionState = {
		doc: readyImageDoc({ crystal: { name: 'doc.pdf', size: 10, contentType: 'application/pdf', mediaKind: 'file' } }),
		updates: []
	};
	const fileResult = await analyzerWith(fileState, { nsfw: false, tosViolation: false })('attachment-1');
	assert.deepEqual(fileResult, { ok: true, status: 'skipped' });
	assert.deepEqual(lastModerationStamp(fileState).categories, ['not-analyzable']);

	const offState: FakeCollectionState = { doc: readyImageDoc(), updates: [] };
	const off = createAnalyzeReadyAttachment({
		getThings: (async () => fakeThings(offState)) as any,
		resolveProvider: async () => ({ kind: 'off' }),
		getS3: () => {
			throw new Error('S3 must not be touched when analysis is off');
		},
		fetchBytes: async () => {
			throw new Error('bytes must not be fetched when analysis is off');
		},
		now: () => NOW
	});
	assert.deepEqual(await off('attachment-1'), { ok: true, status: 'skipped' });
	assert.equal(lastModerationStamp(offState).provider, 'off');
});

test('analyzer leaves the doc pending on provider failure and no-ops landed verdicts', async () => {
	const state: FakeCollectionState = { doc: readyImageDoc(), updates: [] };
	const result = await analyzerWith(state, { nsfw: false, tosViolation: false }, { failProvider: true })('attachment-1');
	assert.deepEqual(result, { ok: false, error: 'Moderation analysis failed', retryable: true });
	// the only moderation write is the pending in-flight marker — no verdict landed
	assert.equal(lastModerationStamp(state).status, 'pending');

	const landed: FakeCollectionState = { doc: readyImageDoc({ moderation: { status: 'clear' } }), updates: [] };
	assert.deepEqual(await analyzerWith(landed, { nsfw: true, tosViolation: false })('attachment-1'), { ok: true, status: 'clear' });
	assert.equal(landed.updates.length, 0);
});
