import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAnalyzeTextThing,
	DEFAULT_TEXT_SCREEN_BUDGET_MS,
	moderatedContentFingerprint,
	moderationTextHash,
	pendingModerationStamp,
	postInsertModerationPlan,
	resolveTextScreenBudgetMs,
	screenTextForCreate,
	setModerationReleaseNotifier,
	SYNC_SCREEN_BREAKER_COOLDOWN_MS,
	SYNC_SCREEN_BREAKER_THRESHOLD,
	TEXT_MODERATED_THINGTIMES,
	type SyncScreenBreaker
} from './analyzeText';
import { moderatedContentOf, hasModeratedContent } from './textModeration';
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
const unsetAt = (doc: any, path: string) => {
	const parts = path.split('.');
	let target = doc;
	for (const part of parts.slice(0, -1)) {
		if (!target?.[part] || typeof target[part] !== 'object') return;
		target = target[part];
	}
	delete target[parts[parts.length - 1]];
};

const fakeCollection = (state: FakeState) => ({
	findOne: async (filter: any) => state.docs.get(filter.shareId) ?? null,
	updateOne: async (filter: any, update: any, options?: any) => {
		state.updates.push({ filter, update, options });
		const existing = state.docs.get(filter.shareId);
		if (existing && matches(existing, filter)) {
			for (const [key, value] of Object.entries(update.$set ?? {})) setAt(existing, key, value);
			for (const key of Object.keys(update.$unset ?? {})) unsetAt(existing, key);
			return { modifiedCount: 1, matchedCount: 1 };
		}
		if (options?.upsert) {
			if (existing) {
				const duplicate = new Error('duplicate key') as Error & { code: number };
				duplicate.code = 11000;
				throw duplicate;
			}
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

test('text flag creation never repurposes an ordinary Thing that squats the deterministic id', async () => {
	const state: FakeState = { docs: new Map([['post-1', postDoc()]]), updates: [] };
	const flagId = moderationFlagShareId('post-1');
	const ordinary = { shareId: flagId, thingtime: ['data'], ownerId: 'attacker', crystal: { keep: true } };
	const home: FakeState = { docs: new Map([[flagId, ordinary]]), updates: [] };
	const result = await textAnalyzer(state, home, { flagged: true, categories: { 'sexual/minors': true } })('post-1');
	assert.deepEqual(result, { ok: false, error: 'Text moderation analysis failed', retryable: true });
	assert.equal(home.docs.get(flagId), ordinary);
	assert.deepEqual(ordinary.crystal, { keep: true });
	assert.equal(state.docs.get('post-1').moderation.status, 'blocked');
	assert.equal(state.docs.get('post-1').moderation.flagPending, true);
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

test('text sweep: off releases pending only; batches analyze and count', async () => {
	const { sweepUnmoderatedTextThings } = await import('./moderationAdmin');
	// off: the only collection work is the stranded-pending release query
	const offResult = await sweepUnmoderatedTextThings({
		resolveText: (async () => ({ kind: 'off' })) as any,
		getThings: (async () => ({
			find: (filter: any) => {
				assert.equal(filter['moderation.status'], 'pending', 'off mode only queries stranded pending docs');
				return { project: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }) };
			}
		})) as any
	});
	assert.deepEqual(offResult, { scanned: 0, analyzed: 0, flagged: 0, failed: 0, skippedOff: true, released: 0 });

	const analyzed: string[] = [];
	const outcomes: Record<string, any> = {
		'post-1': { ok: true, status: 'clear' },
		'post-2': { ok: true, status: 'blocked' },
		'post-3': { ok: false, error: 'openai down', retryable: true },
		'post-4': { ok: true, status: 'unmoderated' }
	};
	const result = await sweepUnmoderatedTextThings({
		resolveText: (async () => ({ kind: 'screen', screen: async () => ({ flagged: false }), provider: 'openai', model: 'omni-moderation-latest' })) as any,
		getThings: (async () => ({
			find: () => ({
				project: () => ({
					sort: () => ({
						limit: () => ({ toArray: async () => Object.keys(outcomes).map((shareId) => ({ shareId })) })
					})
				})
			})
		})) as any,
		analyze: (async (shareId: string) => {
			analyzed.push(shareId);
			return outcomes[shareId];
		}) as any
	});
	assert.deepEqual(analyzed, ['post-1', 'post-2', 'post-3', 'post-4']);
	assert.deepEqual(result, { scanned: 4, analyzed: 2, flagged: 1, failed: 1, skippedOff: false });
});

test('moderation sweep continues full successful batches, but not failures or short batches', async () => {
	const { ATTACHMENT_SWEEP_BATCH, TEXT_SWEEP_BATCH, shouldContinueModerationSweep } = await import('./moderationAdmin');
	const text = (scanned: number, failed = 0) => ({ scanned, analyzed: scanned - failed, flagged: 0, failed, skippedOff: false });
	const attachments = (scanned: number, failed = 0) => ({ scanned, analyzed: scanned - failed, flagged: 0, skipped: 0, failed });
	assert.equal(shouldContinueModerationSweep(text(TEXT_SWEEP_BATCH), attachments(0)), true);
	assert.equal(shouldContinueModerationSweep(text(0), attachments(ATTACHMENT_SWEEP_BATCH)), true);
	assert.equal(shouldContinueModerationSweep(text(TEXT_SWEEP_BATCH, 1), attachments(0)), false);
	assert.equal(shouldContinueModerationSweep(text(0), attachments(ATTACHMENT_SWEEP_BATCH, 1)), false);
	assert.equal(shouldContinueModerationSweep(text(TEXT_SWEEP_BATCH - 1), attachments(ATTACHMENT_SWEEP_BATCH - 1)), false);
});

test('moderation sweep cron route requires the exact bearer secret, starts a continuation, and fails closed unconfigured', async () => {
	const { createModerationSweepLoader } = await import('../../../routes/api/v1/moderation/sweep/_sweep');
	let sweeps = 0;
	let continuations = 0;
	const loader = createModerationSweepLoader({
		getSecret: () => 'cron-test-secret',
		sweepText: (async () => {
			sweeps += 1;
			return { scanned: 25, analyzed: 25, flagged: 0, failed: 0, skippedOff: false };
		}) as any,
		sweepAttachments: (async () => ({ scanned: 0, analyzed: 0, flagged: 0, skipped: 0, failed: 0 })) as any,
		startContinuation: async () => {
			continuations += 1;
			return 'wrun_test_continuation';
		}
	});
	for (const authorization of [undefined, 'cron-test-secret', 'bearer cron-test-secret', 'Bearer wrong']) {
		const response = await loader({
			request: new Request('https://thingtime.example/api/v1/moderation/sweep', {
				headers: authorization ? { Authorization: authorization } : {}
			})
		});
		assert.equal(response.status, 401);
	}
	assert.equal(sweeps, 0);

	const authorized = await loader({
		request: new Request('https://thingtime.example/api/v1/moderation/sweep', { headers: { Authorization: 'Bearer cron-test-secret' } })
	});
	assert.equal(authorized.status, 200);
	const body = await authorized.json();
	assert.equal(body.ok, true);
	assert.equal(body.text.analyzed, 25);
	assert.equal(body.continuationRunId, 'wrun_test_continuation');
	assert.equal(sweeps, 1);
	assert.equal(continuations, 1);

	const unconfigured = createModerationSweepLoader({ getSecret: () => undefined });
	const response = await unconfigured({ request: new Request('https://thingtime.example/api/v1/moderation/sweep') });
	assert.equal(response.status, 503);
});

test('sync screen budget env parsing: default, override, disable, clamp', () => {
	assert.equal(resolveTextScreenBudgetMs({} as any), DEFAULT_TEXT_SCREEN_BUDGET_MS);
	assert.equal(resolveTextScreenBudgetMs({ TT_TEXT_SCREEN_BUDGET_MS: '250' } as any), 250);
	assert.equal(resolveTextScreenBudgetMs({ TT_TEXT_SCREEN_BUDGET_MS: '0' } as any), 0);
	for (const bad of ['999999', '-5', 'nope', '']) {
		assert.equal(resolveTextScreenBudgetMs({ TT_TEXT_SCREEN_BUDGET_MS: bad } as any), DEFAULT_TEXT_SCREEN_BUDGET_MS);
	}
});

const freshBreaker = (): SyncScreenBreaker => ({ failures: 0, openUntil: 0 });
const content = (text: string, imageUrls: string[] = []) => ({ text, imageUrls });

test('create-time sync screen: fast verdicts gate the doc, slow/broken omni falls back to owner-private pending', async () => {
	const screenChoice = (result: OmniModerationResult | 'hang' | 'throw') => async () =>
		({
			kind: 'screen' as const,
			provider: 'openai',
			model: 'omni-moderation-latest',
			screen: async () => {
				if (result === 'hang') return new Promise<never>(() => {});
				if (result === 'throw') throw new Error('openai down');
				return result;
			}
		}) as any;

	// fast blocked verdict → the doc is born blocked
	const blocked = await screenTextForCreate(content('vile text'), {
		resolveText: screenChoice({ flagged: true, categories: { 'sexual/minors': true } }),
		budgetMs: 1000,
		now: () => NOW,
		breaker: freshBreaker()
	});
	assert.ok(blocked.kind === 'verdict' && blocked.stamp.status === 'blocked' && blocked.stamp.provider === 'openai');

	// fast clean verdict → born clear (no async call needed)
	const clear = await screenTextForCreate(content('hello'), {
		resolveText: screenChoice({ flagged: false }),
		budgetMs: 1000,
		now: () => NOW,
		breaker: freshBreaker()
	});
	assert.ok(clear.kind === 'verdict' && clear.stamp.status === 'clear');

	// slow omni → unavailable within the budget (fail-closed: born pending)
	const started = Date.now();
	assert.equal((await screenTextForCreate(content('hello'), { resolveText: screenChoice('hang'), budgetMs: 25, now: () => NOW, breaker: freshBreaker() })).kind, 'unavailable');
	assert.ok(Date.now() - started < 1000, 'timeout resolves promptly');

	// omni error → unavailable (fail-closed)
	assert.equal((await screenTextForCreate(content('hello'), { resolveText: screenChoice('throw'), budgetMs: 1000, now: () => NOW, breaker: freshBreaker() })).kind, 'unavailable');

	// off surface and contentless input → skip (publish normally)
	assert.equal((await screenTextForCreate(content('hello'), { resolveText: (async () => ({ kind: 'off' })) as any, budgetMs: 1000, breaker: freshBreaker() })).kind, 'skip');
	assert.equal((await screenTextForCreate(content('   '), { resolveText: screenChoice({ flagged: false }), budgetMs: 1000, breaker: freshBreaker() })).kind, 'skip');

	// budget 0 = async-release mode: settings still resolve (off must publish
	// normally) but an active surface fails closed without calling omni
	let screens = 0;
	const asyncRelease = await screenTextForCreate(content('hello'), {
		resolveText: (async () => ({
			kind: 'screen',
			provider: 'openai',
			model: 'omni-moderation-latest',
			screen: async () => {
				screens += 1;
				return { flagged: false };
			}
		})) as any,
		budgetMs: 0,
		breaker: freshBreaker()
	});
	assert.equal(asyncRelease.kind, 'unavailable');
	assert.equal(screens, 0, 'budget 0 never calls omni');
	assert.equal((await screenTextForCreate(content('hello'), { resolveText: (async () => ({ kind: 'off' })) as any, budgetMs: 0, breaker: freshBreaker() })).kind, 'skip');
});

test('sync screen stamps carry textHash; flagged ones carry flagPending; advisory nsfw passes through', async () => {
	const choiceOf = (result: OmniModerationResult) => async () =>
		({ kind: 'screen' as const, provider: 'openai', model: 'omni-moderation-latest', screen: async () => result }) as any;
	const blocked = await screenTextForCreate(content('vile'), { resolveText: choiceOf({ flagged: true, categories: { 'sexual/minors': true } }), budgetMs: 1000, now: () => NOW, breaker: freshBreaker() });
	assert.ok(blocked.kind === 'verdict' && blocked.stamp.flagPending === true);
	assert.ok(blocked.kind === 'verdict' && blocked.stamp.textHash === moderatedContentFingerprint(content('vile')));
	const advisory = await screenTextForCreate(content('edgy'), { resolveText: choiceOf({ flagged: true, categories: { harassment: true } }), budgetMs: 1000, now: () => NOW, breaker: freshBreaker() });
	assert.ok(advisory.kind === 'verdict' && advisory.stamp.status === 'nsfw' && advisory.stamp.flagPending === true);
	const clear = await screenTextForCreate(content('hello'), { resolveText: choiceOf({ flagged: false }), budgetMs: 1000, now: () => NOW, breaker: freshBreaker() });
	assert.ok(clear.kind === 'verdict' && clear.stamp.status === 'clear' && clear.stamp.flagPending === undefined);
	assert.ok(clear.kind === 'verdict' && clear.stamp.textHash === moderatedContentFingerprint(content('hello')));
	// the born-private stamp: pending, non-admin, fingerprinted
	const pending = pendingModerationStamp(content('hello'));
	assert.deepEqual({ status: pending.status, provider: pending.provider }, { status: 'pending', provider: 'openai' });
	assert.equal(pending.textHash, moderatedContentFingerprint(content('hello')));
});

test('sync screen: hung settings read cannot hold a post past the budget; late rejections are handled', async () => {
	const started = Date.now();
	assert.equal((await screenTextForCreate(content('hello'), { resolveText: () => new Promise<never>(() => {}), budgetMs: 25, now: () => NOW, breaker: freshBreaker() })).kind, 'unavailable');
	assert.ok(Date.now() - started < 1000, 'hung settings read must lose the race');

	// a screen that rejects AFTER the timeout won must not surface anywhere
	const lateReject = await screenTextForCreate(content('hello'), {
		resolveText: (async () => ({
			kind: 'screen',
			provider: 'openai',
			model: 'omni-moderation-latest',
			screen: () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late failure')), 40))
		})) as any,
		budgetMs: 10,
		now: () => NOW,
		breaker: freshBreaker()
	});
	assert.equal(lateReject.kind, 'unavailable');
	await new Promise((resolve) => setTimeout(resolve, 80));

	// clamp boundary: 10000 is accepted, 10001 falls back to the default
	assert.equal(resolveTextScreenBudgetMs({ TT_TEXT_SCREEN_BUDGET_MS: '10000' } as any), 10000);
	assert.equal(resolveTextScreenBudgetMs({ TT_TEXT_SCREEN_BUDGET_MS: '10001' } as any), DEFAULT_TEXT_SCREEN_BUDGET_MS);
});

test('post-insert moderation plan: notify/inlineFlag/queueAsync branching', () => {
	const base = { thingtime: ['post'], crystal: { text: 'hello' } };
	assert.deepEqual(postInsertModerationPlan({ ...base, moderation: { status: 'blocked' } }), { notify: false, inlineFlag: true, queueAsync: false });
	assert.deepEqual(postInsertModerationPlan({ ...base, moderation: { status: 'nsfw' } }), { notify: true, inlineFlag: true, queueAsync: false });
	assert.deepEqual(postInsertModerationPlan({ ...base, moderation: { status: 'clear' } }), { notify: true, inlineFlag: false, queueAsync: false });
	// born-pending: private, silent, queued for release
	assert.deepEqual(postInsertModerationPlan({ ...base, moderation: { status: 'pending' } }), { notify: false, inlineFlag: false, queueAsync: true });
	assert.deepEqual(postInsertModerationPlan(base), { notify: true, inlineFlag: false, queueAsync: true });
	// non-text kinds never queue or flag, whatever their fields say
	assert.deepEqual(postInsertModerationPlan({ thingtime: ['user'], crystal: { text: 'x' } }), { notify: true, inlineFlag: false, queueAsync: false });
	assert.deepEqual(postInsertModerationPlan({ thingtime: ['post'], crystal: { text: '   ' } }), { notify: true, inlineFlag: false, queueAsync: false });
});

test('a non-admin block on identical text is sticky against provider flip-flops; edits re-verdict freely', async () => {
	const hash = moderatedContentFingerprint(content('hello world'));
	const flipFlop: FakeState = {
		docs: new Map([['post-1', postDoc({ moderation: { status: 'blocked', provider: 'openai', textHash: hash } })]]),
		updates: []
	};
	const home: FakeState = { docs: new Map(), updates: [] };
	// same text, provider now says clean → block retained + flag refreshed
	const result = await textAnalyzer(flipFlop, home, { flagged: false })('post-1');
	assert.deepEqual(result, { ok: true, status: 'blocked' });
	assert.equal(flipFlop.docs.get('post-1').moderation.status, 'blocked');
	assert.ok(home.docs.get(moderationFlagShareId('post-1')), 'flag lands for admin review');

	// different text (hash mismatch = a real edit) → fresh clear verdict wins
	const edited: FakeState = {
		docs: new Map([['post-1', postDoc({ moderation: { status: 'blocked', provider: 'openai', textHash: 'stale-hash' } })]]),
		updates: []
	};
	const editedHome: FakeState = { docs: new Map(), updates: [] };
	assert.deepEqual(await textAnalyzer(edited, editedHome, { flagged: false })('post-1'), { ok: true, status: 'clear' });
	assert.equal(edited.docs.get('post-1').moderation.status, 'clear');
});

test('analyzer stamps are fenced to the text they screened and carry its hash; flag success clears flagPending', async () => {
	const state: FakeState = {
		docs: new Map([['post-1', postDoc({ moderation: { status: 'blocked', provider: 'openai', flagPending: true, textHash: moderatedContentFingerprint(content('hello world')) } })]]),
		updates: []
	};
	const home: FakeState = { docs: new Map(), updates: [] };
	await textAnalyzer(state, home, { flagged: true, categories: { 'sexual/minors': true } })('post-1');
	const stampWrite = state.updates.find((entry) => entry.update?.$set?.moderation)!;
	assert.equal(stampWrite.filter['crystal.text'], 'hello world', 'stamp is fenced to the screened text');
	const doc = state.docs.get('post-1');
	assert.equal(doc.moderation.textHash, moderatedContentFingerprint(content('hello world')));
	assert.equal(doc.moderation.flagPending, undefined, 'flagPending cleared once the flag landed');
	assert.ok(home.docs.get(moderationFlagShareId('post-1')));
});

test('sweep filter drains unstamped/flag-lost docs with prose OR external image URLs', async () => {
	const { UNMODERATED_TEXT_FILTER } = await import('./moderationAdmin');
	const [contentClause, stampClause] = (UNMODERATED_TEXT_FILTER as any).$and;
	assert.deepEqual(contentClause.$or[1], { 'crystal.images.0': { $exists: true } });
	assert.deepEqual(stampClause.$or, [{ moderation: { $exists: false } }, { 'moderation.flagPending': true }, { 'moderation.status': 'pending' }]);
});

test('moderated content covers prose, listing text, tags, and capped http(s) image URLs', () => {
	const extracted = moderatedContentOf({
		crystal: {
			text: 'hello',
			listing: { title: 'Vintage bike', location: 'Sydney', category: 'bikes', condition: 'used', price: 100 },
			images: ['https://a.example/1.png', 'HTTP://b.example/2.jpg', 'javascript:alert(1)', 'ftp://c.example/x', '   https://d.example/3.png  ', 42]
		},
		tags: ['fun', ' bikes ', 7]
	});
	assert.ok(extracted.text.includes('hello') && extracted.text.includes('Vintage bike') && extracted.text.includes('Sydney'));
	assert.ok(extracted.text.includes('tags: fun,  bikes '));
	assert.deepEqual(extracted.imageUrls, ['https://a.example/1.png', 'HTTP://b.example/2.jpg', 'https://d.example/3.png']);
	// cap at 8 URLs
	const many = moderatedContentOf({ crystal: { images: Array.from({ length: 20 }, (_v, index) => `https://x.example/${index}.png`) } });
	assert.equal(many.imageUrls.length, 8);
	assert.equal(hasModeratedContent(moderatedContentOf({ crystal: { text: '  ' } })), false);
	assert.equal(hasModeratedContent(moderatedContentOf({ crystal: { images: ['https://a.example/1.png'] } })), true);
});

test('image-URL-only posts are screened and can flag with a URL excerpt', async () => {
	const state: FakeState = {
		docs: new Map([['post-1', postDoc({ crystal: { type: 'photos', images: ['https://a.example/1.png'] } })]]),
		updates: []
	};
	const home: FakeState = { docs: new Map(), updates: [] };
	const result = await textAnalyzer(state, home, { flagged: true, categories: { sexual: true } })('post-1');
	assert.deepEqual(result, { ok: true, status: 'nsfw' });
	const flag = home.docs.get(moderationFlagShareId('post-1'));
	assert.ok(flag.crystal.excerpt.includes('https://a.example/1.png'));
});

test('sync-screen circuit breaker opens after consecutive failures and re-probes after cooldown', async () => {
	const breaker = freshBreaker();
	const failing = { resolveText: (async () => { throw new Error('down'); }) as any, budgetMs: 50, now: () => NOW, breaker, nowMs: () => 1_000_000 };
	for (let attempt = 0; attempt < SYNC_SCREEN_BREAKER_THRESHOLD; attempt += 1) {
		assert.equal((await screenTextForCreate(content('hello'), failing)).kind, 'unavailable');
	}
	assert.equal(breaker.openUntil, 1_000_000 + SYNC_SCREEN_BREAKER_COOLDOWN_MS, 'breaker opened');
	// open breaker: settings still resolve (off must skip) but omni is never
	// called — an active surface goes born-pending with zero omni toll
	let screens = 0;
	const duringOutage = await screenTextForCreate(content('hello'), {
		resolveText: (async () => ({
			kind: 'screen',
			provider: 'openai',
			model: 'omni-moderation-latest',
			screen: async () => {
				screens += 1;
				return { flagged: false };
			}
		})) as any,
		budgetMs: 50,
		breaker,
		nowMs: () => 1_000_000 + 5
	});
	assert.equal(duringOutage.kind, 'unavailable');
	assert.equal(screens, 0, 'open breaker never calls omni');
	assert.equal((await screenTextForCreate(content('hello'), { resolveText: (async () => ({ kind: 'off' })) as any, budgetMs: 50, breaker, nowMs: () => 1_000_000 + 5 })).kind, 'skip');
	// cooldown expired: the next post probes again and a success resets state
	const probe = await screenTextForCreate(content('hello'), {
		resolveText: (async () => ({ kind: 'screen', provider: 'openai', model: 'omni-moderation-latest', screen: async () => ({ flagged: false }) })) as any,
		budgetMs: 1000,
		now: () => NOW,
		breaker,
		nowMs: () => 1_000_000 + SYNC_SCREEN_BREAKER_COOLDOWN_MS + 1
	});
	assert.ok(probe.kind === 'verdict' && probe.stamp.status === 'clear');
	assert.equal(breaker.failures, 0);
});

test('releasing a born-pending doc emits its deferred creation notification', async () => {
	const released: string[] = [];
	setModerationReleaseNotifier((shareId) => released.push(shareId));
	try {
		const state: FakeState = {
			docs: new Map([['post-1', postDoc({ moderation: pendingModerationStamp(content('hello world')) })]]),
			updates: []
		};
		const home: FakeState = { docs: new Map(), updates: [] };
		assert.deepEqual(await textAnalyzer(state, home, { flagged: false })('post-1'), { ok: true, status: 'clear' });
		assert.deepEqual(released, ['post-1'], 'clear release notifies');
		// blocked release stays silent (still invisible)
		const blockedState: FakeState = {
			docs: new Map([['post-1', postDoc({ moderation: pendingModerationStamp(content('hello world')) })]]),
			updates: []
		};
		await textAnalyzer(blockedState, home, { flagged: true, categories: { 'sexual/minors': true } })('post-1');
		assert.deepEqual(released, ['post-1'], 'blocked release does not notify');
	} finally {
		setModerationReleaseNotifier(() => {});
	}
});

test('sweep with the surface off releases stranded born-pending docs', async () => {
	const { sweepUnmoderatedTextThings } = await import('./moderationAdmin');
	const released: string[] = [];
	setModerationReleaseNotifier((shareId) => released.push(shareId));
	try {
		const pendingDocs = [
			{ shareId: 'post-1', moderation: { status: 'pending', provider: 'openai' } },
			{ shareId: 'post-2', moderation: { status: 'pending', provider: 'openai' } }
		];
		const updates: any[] = [];
		const result = await sweepUnmoderatedTextThings({
			resolveText: (async () => ({ kind: 'off' })) as any,
			getThings: (async () => ({
				find: () => ({ project: () => ({ sort: () => ({ limit: () => ({ toArray: async () => pendingDocs }) }) }) }),
				updateOne: async (filter: any, update: any) => {
					updates.push({ filter, update });
					return { modifiedCount: 1, matchedCount: 1 };
				}
			})) as any
		});
		assert.deepEqual(result, { scanned: 2, analyzed: 0, flagged: 0, failed: 0, skippedOff: true, released: 2 });
		assert.deepEqual(released, ['post-1', 'post-2']);
		assert.ok(updates.every((entry) => entry.update.$unset?.moderation === '' && entry.filter['moderation.provider'].$ne === 'admin'));
	} finally {
		setModerationReleaseNotifier(() => {});
	}
});
