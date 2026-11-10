import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverProviderModels, discoverConfiguredProviderModels, ModelDiscoveryHttpError, isModelUnavailableError } from './modelDiscovery';
import { createAiModelSync, createMongoModelSyncStore } from './modelSync';
import { createAiModelSyncLoader } from '../../../routes/api/v1/ai/models/sync/_sync';
import { getAiModelCatalogEntry, resolveLopuModelChoice, publicAiModel } from './modelsCore';

const request = { url: 'https://provider.test/v1/models', headers: { authorization: 'Bearer fixture-only' } };
const response = (body: unknown, status = 200) => Response.json(body, { status });

test('discovery consumes all Anthropic pages and never follows redirects', async () => {
	const urls: string[] = [];
	const models = await discoverProviderModels('anthropic', request, (async (url: URL, init: RequestInit) => {
		urls.push(String(url));
		assert.equal(init.redirect, 'manual');
		assert.ok(init.signal);
		return urls.length === 1
			? response({ data: [{ id: 'claude-fable-5-1' }], has_more: true, last_id: 'claude-fable-5-1' })
			: response({ data: [{ id: 'claude-opus-5' }], has_more: false });
	}) as any);
	assert.deepEqual(
		models.map((m) => m.id),
		['claude-fable-5-1', 'claude-opus-5']
	);
	assert.match(urls[1], /after_id=claude-fable-5-1/);
});

test('partial, empty, malformed, redirected, oversized and failed lists cannot retire models', async () => {
	for (const fake of [
		() => response({ data: [] }),
		() => response({ data: [{ id: 12 }] }),
		() => response({ data: [{ id: 'gpt-5' }], has_more: 'yes' }),
		() => response({ secret: 'must not escape' }, 401),
		() => new Response(null, { status: 302, headers: { location: 'https://attacker.test' } }),
		() => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
		() => {
			throw new Error('network failure with secret');
		}
	])
		await assert.rejects(discoverProviderModels('openai', request, fake as any));
	let calls = 0;
	await assert.rejects(
		discoverProviderModels('anthropic', request, (async () =>
			++calls === 1 ? response({ data: [{ id: 'claude-opus-5' }], has_more: true, last_id: 'same' }) : response({}, 503)) as any)
	);
});

test('model errors trigger refresh; auth, quota, generic 404 and bad tools do not', () => {
	for (const error of [
		{ code: 'model_not_found' },
		{ error: { code: 'model_not_available' } },
		{ status: 404, message: 'Model claude-fable-5 does not exist' }
	])
		assert.equal(isModelUnavailableError(error), true);
	for (const error of [
		{ status: 404, message: 'Route not found' },
		{ status: 401, message: 'Model access denied' },
		{ status: 429, message: 'Model unavailable due to quota' },
		{ status: 400, message: 'Unknown tool' },
		new Error('Network unavailable')
	])
		assert.equal(isModelUnavailableError(error), false);
});

test('sync coalesces in-flight runs, preserves failed provider state, and only refreshes model errors', async () => {
	let resolve!: (v: any) => void;
	let claimed = 0,
		published = 0,
		failed = 0;
	const sync = createAiModelSync({
		configured: () => true,
		discover: () =>
			new Promise((r) => {
				resolve = r;
			}),
		store: {
			claim: async () => {
				claimed++;
				return { token: 'lease', startedAt: new Date() };
			},
			publish: async () => {
				published++;
				return true;
			},
			fail: async () => {
				failed++;
			}
		}
	});
	assert.equal(await sync.recover('anthropic', { status: 429 }), null);
	const first = sync.syncProvider('anthropic');
	const second = sync.syncProvider('anthropic', 'unavailable');
	await Promise.resolve();
	resolve([{ id: 'claude-fable-5-1', label: 'Fable 5.1' }]);
	assert.deepEqual(await first, await second);
	assert.equal(claimed, 1);
	assert.equal(published, 1);
	const empty = sync.syncProvider('anthropic');
	await Promise.resolve();
	resolve([]);
	assert.equal((await empty).status, 'failed');
	assert.equal(published, 1);
	assert.equal(failed, 1);
});

test('cron fails closed, refuses mutations/HEAD, and exposes redacted partial-failure reports', async () => {
	let calls = 0;
	const handler = createAiModelSyncLoader({
		secret: () => 'fixture-secret',
		sync: async () => {
			calls++;
			return [{ provider: 'anthropic', status: 'failed' }];
		}
	});
	for (const method of ['HEAD', 'POST']) assert.equal((await handler({ request: new Request('https://tt.test/sync', { method }) })).status, 405);
	assert.equal((await handler({ request: new Request('https://tt.test/sync') })).status, 401);
	assert.equal(calls, 0);
	const res = await handler({ request: new Request('https://tt.test/sync', { headers: { authorization: 'Bearer fixture-secret' } }) });
	assert.equal(res.status, 503);
	assert.match(res.headers.get('cache-control')!, /no-store/);
	assert.equal(calls, 1);
});

test('a newly discovered compatible model resolves with conservative defaults, not invented effort or speed', () => {
	const entry = getAiModelCatalogEntry('claude-fable-6-1')!;
	assert.deepEqual(entry.efforts, []);
	assert.deepEqual(entry.speeds, ['normal']);
	for (const id of ['gpt-image-2', 'gpt-realtime', 'text-embedding-3-large', 'arbitrary-model']) assert.equal(getAiModelCatalogEntry(id), null);
	const model = publicAiModel(entry, true, {
		anthropic: { configured: true, verified: null, checkedAt: null },
		openai: { configured: false, verified: null, checkedAt: null }
	});
	const resolved = resolveLopuModelChoice({ model: entry.modelId }, [model]);
	assert.equal(resolved.ok, true);
	if (resolved.ok) {
		assert.equal(resolved.choice.model, entry.modelId);
		assert.equal(resolved.choice.effort, null);
	}
});

// Exercise the real publication adapter through its collection seam. No test
// contacts Mongo or seeds a database outside the public API.
test('publication is lease-fenced and atomic, preserves disabled models, and auto-admits only compatible new models', async () => {
	const writes: any[] = [];
	let ownsLease = false;
	const settings = {
		updateOne: async () => ({ matchedCount: ownsLease ? 1 : 0 }),
		findOne: async () => ({ autoAllowNewModels: true })
	};
	const things = {
		bulkWrite: async (operations: any[]) => {
			writes.push(...operations.map((op) => op.updateOne));
			return { matchedCount: operations.length };
		},
		updateMany: async (filter: any, update: any) => {
			writes.push({ filter, update });
			return {};
		}
	};
	let transactions = 0;
	const store = createMongoModelSyncStore({
		getThings: async () => things,
		getSettings: async () => settings,
		transaction: async (work: any) => {
			transactions++;
			return work({ transaction: true });
		}
	} as any);
	const claim = { token: 'old-lease', startedAt: new Date() };
	const list = [
		{ id: 'claude-fable-6-1', label: 'Fable 6.1' },
		{ id: 'audio-only', label: 'Audio' }
	];
	assert.equal(await store.publish('anthropic', claim, list), false);
	assert.equal(writes.length, 0);
	ownsLease = true;
	assert.equal(await store.publish('anthropic', claim, list), true);
	assert.equal(transactions, 2);
	const inserts = writes.filter((write) => write.update.$setOnInsert);
	assert.equal(inserts[0].update.$setOnInsert.crystal.enabled, true);
	assert.equal(inserts[1].update.$setOnInsert.crystal.enabled, false);
	assert.ok(
		inserts.some((write) => write.update.$setOnInsert.crystal.modelId === 'claude-fable-5'),
		'known missing models seeded before removal'
	);
	for (const write of writes.filter((write) => write.update.$set))
		assert.equal(write.update.$set['crystal.enabled'], undefined, 'existing choices survive');
	assert.deepEqual(
		writes.at(-1).filter['crystal.modelId'].$nin,
		list.map((m) => m.id)
	);
});

test('Claude catalogue keys are discovery-only, prefer the dedicated key and never leak provider error bodies', async () => {
	for (const [env, expected] of [
		[{ ANTHROPIC_MODELS_API_KEY: 'dedicated-fixture', ANTHROPIC_API_KEY: 'legacy-fixture' }, 'dedicated-fixture'],
		[{ ANTHROPIC_API_KEY: 'legacy-fixture' }, 'legacy-fixture']
	] as const) {
		let calls = 0;
		const models = await discoverConfiguredProviderModels('anthropic', {
			env,
			fetchImpl: (async (_url, init) => {
				calls++;
				assert.equal((init?.headers as any)['x-api-key'], expected);
				assert.equal((init?.headers as any).authorization, undefined);
				return response({ data: [{ id: 'claude-fable-5-1' }], has_more: false });
			}) as typeof fetch
		});
		assert.equal(calls, 1);
		assert.equal(models[0].id, 'claude-fable-5-1');
	}
	const denied = createAiModelSync({
		configured: () => true,
		discover: () => discoverProviderModels('anthropic', request, (async () => response({ error: 'secret-provider-body' }, 403)) as typeof fetch),
		store: {
			claim: async () => ({ token: 'fixture', startedAt: new Date() }),
			publish: async () => {
				throw new Error('must not publish');
			},
			fail: async () => {}
		}
	});
	const result = await denied.syncProvider('anthropic', 'admin');
	assert.equal(result.status, 'failed');
	assert.match(result.reason!, /HTTP 403/);
	assert.match(result.reason!, /ANTHROPIC_MODELS_API_KEY/);
	assert.doesNotMatch(JSON.stringify(result), /secret-provider-body|fixture/);
	assert.equal(new ModelDiscoveryHttpError(401).status, 401);
});

test('keyless public discovery parses lifecycle rows, never credentials, and fails closed on changed tables', async () => {
	const { parsePublicClaudeModels, CLAUDE_PUBLIC_MODELS_URL } = await import('./modelDiscovery');
	const table = '## Model status\n\n| API model name | Current state | Deprecated |\n| --- | --- | --- |\n| claude-opus-5-5 | Active | N/A |\n| claude-sonnet-5-5 | Deprecated | today |\n| claude-opus-4-20250514 | Retired | yesterday |\n\n## Deprecation history\n| claude-opus-99 | Active | N/A |';
	const rows = parsePublicClaudeModels(table);
	assert.deepEqual(rows.map((row) => [row.id, row.lifecycle]), [['claude-opus-5-5', 'active'], ['claude-sonnet-5-5', 'deprecated'], ['claude-opus-4-20250514', 'retired']]);
	assert.equal(rows[0].label, 'Claude Opus 5.5');
	for (const text of ['', '<html>unavailable</html>', table.replace('Current state', 'Unknown column'), table.replace('Active', 'Unknown')]) assert.throws(() => parsePublicClaudeModels(text));
	for (const env of [{}, { ANTHROPIC_MODELS_API_KEY: 'denied-fixture' }]) {
		const urls: string[] = [];
		const found = await discoverConfiguredProviderModels('anthropic', { env, fetchImpl: (async (url, init) => {
			urls.push(String(url));
			if (String(url) !== CLAUDE_PUBLIC_MODELS_URL) return response({}, 403);
			assert.equal((init?.headers as any)?.authorization, undefined);
			assert.equal((init?.headers as any)?.['x-api-key'], undefined);
			assert.equal(init?.redirect, 'error');
			return new Response(table);
		}) as typeof fetch });
		assert.deepEqual(found, rows);
		assert.equal(urls.at(-1), CLAUDE_PUBLIC_MODELS_URL);
	}
});

test('Claude metadata sync runs without inference credentials and reports its source', async () => {
	const sync = createAiModelSync({ configured: () => false,
		discover: async () => [{ id: 'claude-opus-5-5', label: 'Opus 5.5', source: 'public-docs' }],
		store: { claim: async () => ({ token: 'fixture', startedAt: new Date() }), publish: async () => true, fail: async () => {} }
	});
	assert.equal((await sync.syncProvider('anthropic')).source, 'public-docs');
	assert.equal((await sync.syncProvider('openai')).status, 'skipped');
});

test('public publication preserves account availability and admission, only explicit retirement hides a model', async () => {
	const writes: any[] = [];
	const store = createMongoModelSyncStore({
		getSettings: async () => ({ updateOne: async () => ({ matchedCount: 1 }), findOne: async () => ({ autoAllowNewModels: false }) }),
		getThings: async () => ({ bulkWrite: async (ops: any[]) => { writes.push(...ops.map((op) => op.updateOne)); return { matchedCount: ops.length }; }, updateMany: async () => { throw new Error('Public omissions must not retire models'); } }),
		transaction: async (work: any) => work({})
	} as any);
	await store.publish('anthropic', { token: 'fixture', startedAt: new Date() }, [
		{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5', source: 'public-docs', lifecycle: 'active' },
		{ id: 'claude-opus-4-20250514', label: 'Old Opus', source: 'public-docs', lifecycle: 'retired' }
	]);
	assert.equal(writes[0].update.$setOnInsert.crystal.enabled, false);
	const updates = writes.filter((write) => write.update.$set).map((write) => write.update.$set);
	assert.deepEqual(updates.map((update) => update['crystal.publicCatalogAvailable']), [true, false]);
	for (const update of updates) {
		assert.equal(update['crystal.providerAvailable'], undefined);
		assert.equal(update['crystal.lastSyncedAt'], undefined);
		assert.equal(update['crystal.enabled'], undefined);
	}
});
