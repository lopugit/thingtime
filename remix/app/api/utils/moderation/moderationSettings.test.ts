import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnalyzeTextThing, TEXT_MODERATED_THINGTIMES } from './analyzeText';
import { moderationFlagShareId } from './analyzeAttachment';
import { createModerationSettingsStore } from './moderationSettings';
import {
	DEFAULT_MODERATION_SETTINGS,
	normalizeModerationSettings,
	validateModerationSettings
} from './moderationSettingsCore';
import { resolveModerationProvider } from './providers';
import { mapOmniTextVerdict, resolveTextModeration, TEXT_BLOCK_CATEGORIES } from './textModeration';
import type { OmniModerationResult } from './openaiProvider';

const NOW = new Date('2026-08-19T00:00:00.000Z');

test('moderation settings normalize forgivingly and validate strictly', () => {
	assert.deepEqual(normalizeModerationSettings(undefined), DEFAULT_MODERATION_SETTINGS);
	assert.deepEqual(normalizeModerationSettings({ mediaProvider: 'bogus', textProvider: 42 }), DEFAULT_MODERATION_SETTINGS);
	assert.deepEqual(normalizeModerationSettings({ mediaProvider: 'openai', textProvider: 'off' }), { mediaProvider: 'openai', textProvider: 'off' });

	assert.equal(validateModerationSettings(null).ok, false);
	assert.equal(validateModerationSettings({ mediaProvider: 'openai' }).ok, false);
	assert.equal(validateModerationSettings({ mediaProvider: 'nope', textProvider: 'openai' }).ok, false);
	const valid = validateModerationSettings({ mediaProvider: 'openai+claude', textProvider: 'openai' });
	assert.ok(valid.ok && valid.settings.mediaProvider === 'openai+claude');
});

test('settings store round-trips, rejects invalid writes, and degrades to defaults on read failure', async () => {
	let stored: unknown;
	const store = createModerationSettingsStore({
		readStoredSettings: async () => stored,
		writeStoredSettings: async (settings) => {
			stored = settings;
		}
	});
	assert.deepEqual(await store.getSettings(), DEFAULT_MODERATION_SETTINGS);
	await store.setSettings({ mediaProvider: 'openai', textProvider: 'openai' }, 'admin-1');
	assert.deepEqual(await store.getSettings(), { mediaProvider: 'openai', textProvider: 'openai' });
	await assert.rejects(() => store.setSettings({ mediaProvider: 'nope', textProvider: 'openai' }, 'admin-1'), TypeError);

	const failing = createModerationSettingsStore({
		readStoredSettings: async () => {
			throw new Error('mongo down');
		},
		writeStoredSettings: async () => {}
	});
	assert.deepEqual(await failing.getSettings(), DEFAULT_MODERATION_SETTINGS);
});

test('admin media provider choice overrides env resolution; default delegates', async () => {
	const env = { THINGTIME_MODERATION_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' } as any;
	const forcedOff = await resolveModerationProvider(env, 'off');
	assert.equal(forcedOff.kind, 'off');
	const forcedOpenai = await resolveModerationProvider(env, 'openai');
	assert.equal(forcedOpenai.kind === 'provider' && forcedOpenai.provider.name, 'openai');
	const forcedTiered = await resolveModerationProvider(env, 'openai+claude');
	assert.equal(forcedTiered.kind === 'provider' && forcedTiered.provider.name, 'openai+claude');
	const delegated = await resolveModerationProvider(env, 'default');
	assert.equal(delegated.kind === 'provider' && delegated.provider.name, 'claude');
});

test('text verdict mapping splits block-worthy categories from advisory flags', () => {
	const blockResult: OmniModerationResult = {
		flagged: true,
		categories: { 'sexual/minors': true, sexual: true },
		category_scores: { 'sexual/minors': 0.99, sexual: 0.8 }
	};
	const blocked = mapOmniTextVerdict(blockResult);
	assert.deepEqual({ nsfw: blocked.nsfw, tos: blocked.tosViolation }, { nsfw: true, tos: true });
	assert.deepEqual(blocked.categories, ['sexual-minors', 'sexual']);

	const advisory = mapOmniTextVerdict({ flagged: true, categories: { harassment: true }, category_scores: { harassment: 0.7 } });
	assert.deepEqual({ nsfw: advisory.nsfw, tos: advisory.tosViolation }, { nsfw: true, tos: false });

	const clean = mapOmniTextVerdict({ flagged: false, categories: {}, category_scores: {} });
	assert.deepEqual({ nsfw: clean.nsfw, tos: clean.tosViolation }, { nsfw: false, tos: false });

	for (const category of TEXT_BLOCK_CATEGORIES) {
		const verdict = mapOmniTextVerdict({ flagged: true, categories: { [category]: true } });
		assert.equal(verdict.tosViolation, true, `${category} must block`);
	}
});

test('text moderation resolution honors the admin choice and key default', () => {
	assert.equal(resolveTextModeration({} as any, 'off').kind, 'off');
	assert.equal(resolveTextModeration({ OPENAI_API_KEY: 'o' } as any, 'off').kind, 'off');
	assert.equal(resolveTextModeration({ OPENAI_API_KEY: 'o' } as any, 'default').kind, 'screen');
	assert.equal(resolveTextModeration({} as any, 'default').kind, 'off');
	const explicit = resolveTextModeration({} as any, 'openai');
	assert.equal(explicit.kind, 'screen');
});

type FakeState = { docs: Map<string, any>; updates: Array<{ filter: any; update: any; options?: any }> };

// The fake evaluates the actual filters the analyzer sends ($or/$exists/$ne,
// dotted paths) instead of special-casing them — a broken guard must FAIL here.
const valueAt = (doc: any, path: string) => path.split('.').reduce((acc: any, part) => (acc == null ? undefined : acc[part]), doc);
const matches = (doc: any, filter: any): boolean => {
	if (!doc) return false;
	for (const [key, cond] of Object.entries(filter)) {
		if (key === '$or') {
			if (!(cond as any[]).some((sub) => matches(doc, sub))) return false;
			continue;
		}
		const value = valueAt(doc, key);
		if (cond && typeof cond === 'object' && !Array.isArray(cond) && ('$exists' in (cond as any) || '$ne' in (cond as any) || '$in' in (cond as any))) {
			const c = cond as any;
			if ('$exists' in c && (value !== undefined) !== c.$exists) return false;
			if ('$ne' in c && value === c.$ne) return false;
			if ('$in' in c && !c.$in.includes(value)) return false;
		} else if (Array.isArray(value) ? !value.includes(cond) : value !== cond) return false;
	}
	return true;
};
const setAt = (doc: any, path: string, value: any) => {
	const parts = path.split('.');
	let target = doc;
	for (const part of parts.slice(0, -1)) target = target[part] ??= {};
	target[parts[parts.length - 1]] = value;
};

const fakeCollection = (state: FakeState) => ({
	findOne: async (filter: any) => state.docs.get(filter.shareId) ?? null,
	updateOne: async (filter: any, update: any, options?: any) => {
		state.updates.push({ filter, update, options });
		const existing = state.docs.get(filter.shareId);
		if (existing && matches(existing, filter)) {
			for (const [key, value] of Object.entries(update.$set ?? {})) setAt(existing, key, value);
			for (const key of Object.keys(update.$unset ?? {})) delete existing[key];
			return { modifiedCount: 1, matchedCount: 1 };
		}
		if (options?.upsert) {
			const inserted: any = { ...(update.$setOnInsert ?? {}) };
			for (const [key, value] of Object.entries(update.$set ?? {})) setAt(inserted, key, value);
			state.docs.set(filter.shareId, inserted);
			return { modifiedCount: 1, matchedCount: 0, upsertedCount: 1 };
		}
		return { modifiedCount: 0, matchedCount: 0 };
	}
});

const textAnalyzer = (state: FakeState, homeState: FakeState, result: OmniModerationResult | Error, provider: 'screen' | 'off' = 'screen') =>
	createAnalyzeTextThing({
		getThings: (async () => fakeCollection(state)) as any,
		getHomeThings: (async () => fakeCollection(homeState)) as any,
		resolveText: async () =>
			provider === 'off'
				? { kind: 'off' }
				: {
						kind: 'screen',
						provider: 'openai',
						model: 'omni-moderation-latest',
						screen: async () => {
							if (result instanceof Error) throw result;
							return result;
						}
					},
		now: () => NOW
	});

const postDoc = (overrides: Record<string, unknown> = {}) => ({
	shareId: 'post-1',
	thingtime: ['post'],
	ownerId: 'user-1',
	crystal: { type: 'text', text: 'hello world' },
	...overrides
});

const flagDoc = (overrides: Record<string, unknown> = {}) => ({
	shareId: moderationFlagShareId('post-1'),
	thingtime: ['moderationFlag'],
	crystal: { targetKind: 'text', status: 'nsfw', reviewedBy: null },
	...overrides
});

test('text analyzer stamps verdicts on the thing and flags blocked/nsfw text with an excerpt', async () => {
	const state: FakeState = { docs: new Map([['post-1', postDoc()]]), updates: [] };
	const home: FakeState = { docs: new Map(), updates: [] };
	const result = await textAnalyzer(state, home, { flagged: true, categories: { 'sexual/minors': true }, category_scores: {} })('post-1');
	assert.deepEqual(result, { ok: true, status: 'blocked' });
	assert.equal(state.docs.get('post-1').moderation.status, 'blocked');
	assert.equal(state.docs.get('post-1').moderation.provider, 'openai');
	const flag = home.docs.get(moderationFlagShareId('post-1'));
	assert.ok(flag, 'text flag upserted on home');
	assert.equal(flag.crystal.targetKind, 'text');
	assert.equal(flag.crystal.excerpt, 'hello world');
	assert.equal(flag.crystal.attachmentPurpose, 'post');
});

test('text analyzer labels comment/share purposes and bounds the excerpt at 500 chars', async () => {
	const longText = 'x'.repeat(600);
	const comment: FakeState = {
		docs: new Map([['post-1', postDoc({ thingtime: ['comment'], crystal: { text: longText } })]]),
		updates: []
	};
	const home: FakeState = { docs: new Map(), updates: [] };
	await textAnalyzer(comment, home, { flagged: true, categories: { harassment: true } })('post-1');
	const flag = home.docs.get(moderationFlagShareId('post-1'));
	assert.equal(flag.crystal.attachmentPurpose, 'comment');
	assert.equal(flag.crystal.excerpt.length, 500);

	const share: FakeState = { docs: new Map([['post-1', postDoc({ thingtime: ['post', 'share'] })]]), updates: [] };
	const shareHome: FakeState = { docs: new Map(), updates: [] };
	await textAnalyzer(share, shareHome, { flagged: true, categories: { harassment: true } })('post-1');
	assert.equal(shareHome.docs.get(moderationFlagShareId('post-1')).crystal.attachmentPurpose, 'share');
});

test('text analyzer: clean text stamps clear with no flag; off/unknown do nothing durable', async () => {
	const state: FakeState = { docs: new Map([['post-1', postDoc()]]), updates: [] };
	const home: FakeState = { docs: new Map(), updates: [] };
	assert.deepEqual(await textAnalyzer(state, home, { flagged: false })('post-1'), { ok: true, status: 'clear' });
	assert.equal(state.docs.get('post-1').moderation.status, 'clear');
	assert.equal(home.docs.size, 0);

	const offState: FakeState = { docs: new Map([['post-1', postDoc()]]), updates: [] };
	assert.deepEqual(await textAnalyzer(offState, home, { flagged: true }, 'off')('post-1'), { ok: true, status: 'unmoderated' });
	assert.equal(offState.updates.length, 0);

	const missing: FakeState = { docs: new Map(), updates: [] };
	assert.equal((await textAnalyzer(missing, home, { flagged: true })('missing')).ok, false);
	const wrongKind: FakeState = { docs: new Map([['post-1', postDoc({ thingtime: ['user'] })]]), updates: [] };
	assert.equal((await textAnalyzer(wrongKind, home, { flagged: true })('post-1')).ok, false);
});

test('re-analysis that clears edited text resolves the unreviewed flag; reviewed flags stay as audit log', async () => {
	const state: FakeState = { docs: new Map([['post-1', postDoc({ moderation: { status: 'nsfw', provider: 'openai' } })]]), updates: [] };
	const home: FakeState = { docs: new Map([[moderationFlagShareId('post-1'), flagDoc()]]), updates: [] };
	await textAnalyzer(state, home, { flagged: false })('post-1');
	assert.equal(state.docs.get('post-1').moderation.status, 'clear');
	assert.equal(home.docs.get(moderationFlagShareId('post-1')).crystal.status, 'clear');

	// a reviewed flag is the audit record — clearing must not rewrite it
	const reviewedHome: FakeState = {
		docs: new Map([[moderationFlagShareId('post-1'), flagDoc({ crystal: { targetKind: 'text', status: 'nsfw', reviewedBy: 'admin-1' } })]]),
		updates: []
	};
	const state2: FakeState = { docs: new Map([['post-1', postDoc({ moderation: { status: 'nsfw', provider: 'openai' } })]]), updates: [] };
	await textAnalyzer(state2, reviewedHome, { flagged: false })('post-1');
	assert.equal(reviewedHome.docs.get(moderationFlagShareId('post-1')).crystal.status, 'nsfw');
});

test('emptied text clears a stale pipeline stamp but never an admin stamp', async () => {
	const state: FakeState = {
		docs: new Map([['post-1', postDoc({ crystal: { text: '   ' }, moderation: { status: 'blocked', provider: 'openai' } })]]),
		updates: []
	};
	const home: FakeState = { docs: new Map([[moderationFlagShareId('post-1'), flagDoc({ crystal: { targetKind: 'text', status: 'blocked', reviewedBy: null } })]]), updates: [] };
	assert.deepEqual(await textAnalyzer(state, home, { flagged: true })('post-1'), { ok: true, status: 'unmoderated' });
	assert.equal(state.docs.get('post-1').moderation, undefined);
	assert.equal(home.docs.get(moderationFlagShareId('post-1')).crystal.status, 'clear');

	const adminState: FakeState = {
		docs: new Map([['post-1', postDoc({ crystal: { text: '' }, moderation: { status: 'blocked', provider: 'admin' } })]]),
		updates: []
	};
	const adminHome: FakeState = { docs: new Map(), updates: [] };
	await textAnalyzer(adminState, adminHome, { flagged: true })('post-1');
	assert.equal(adminState.docs.get('post-1').moderation.status, 'blocked');
	assert.equal(adminHome.updates.length, 0);
});

test('admin stamps stay final on the thing, but a flagged post-review edit resurfaces in the queue', async () => {
	const adminStamped: FakeState = {
		docs: new Map([['post-1', postDoc({ moderation: { status: 'clear', provider: 'admin' } })]]),
		updates: []
	};
	const home: FakeState = {
		docs: new Map([[moderationFlagShareId('post-1'), flagDoc({ crystal: { targetKind: 'text', status: 'clear', reviewedBy: 'admin-1' } })]]),
		updates: []
	};
	await textAnalyzer(adminStamped, home, { flagged: true, categories: { 'sexual/minors': true } })('post-1');
	// the thing keeps the admin verdict (guarded $or filter really evaluated)…
	assert.equal(adminStamped.docs.get('post-1').moderation.status, 'clear');
	assert.equal(adminStamped.docs.get('post-1').moderation.provider, 'admin');
	// …but the flag re-enters the unreviewed queue with the new evidence
	const flag = home.docs.get(moderationFlagShareId('post-1'));
	assert.equal(flag.crystal.status, 'blocked');
	assert.equal(flag.crystal.reviewedBy, null);
});

test('screen failures leave no verdict stamp', async () => {
	const state: FakeState = { docs: new Map([['post-1', postDoc()]]), updates: [] };
	const home: FakeState = { docs: new Map(), updates: [] };
	const failed = await textAnalyzer(state, home, new Error('openai down'))('post-1');
	assert.deepEqual(failed, { ok: false, error: 'Text moderation analysis failed', retryable: true });
	assert.equal(state.docs.get('post-1').moderation, undefined);
});

test('text-moderated kinds cover the post family only', () => {
	assert.deepEqual([...TEXT_MODERATED_THINGTIMES].sort(), ['comment', 'post', 'share']);
});
