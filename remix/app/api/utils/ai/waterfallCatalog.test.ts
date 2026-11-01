import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAiWaterfallEndpoints } from './waterfallCatalog';

test('workflow scopes use newly discovered live models; other caller restrictions and default endpoint survive', () => {
	const old = { id: 'claude-opus-5', label: 'Opus 5', efforts: [], speeds: ['normal' as const] };
	const newest = { ...old, id: 'claude-opus-5-5' };
	const requested = [{ id: 'server:anthropic', label: 'Anthropic', models: [old] }, { id: 'default', label: 'Default', models: [] }];
	const live = [{ id: 'server:anthropic', label: 'Anthropic', models: [newest] }];
	assert.deepEqual(resolveAiWaterfallEndpoints(requested, live, true)[0].models, [newest]);
	assert.deepEqual(resolveAiWaterfallEndpoints(requested, live, true)[1], requested[1]);
	assert.deepEqual(resolveAiWaterfallEndpoints(requested, live)[0].models, []);
	assert.deepEqual(resolveAiWaterfallEndpoints(requested, [], true)[0].models, []);
});
