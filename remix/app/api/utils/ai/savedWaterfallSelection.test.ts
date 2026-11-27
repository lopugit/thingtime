import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingSavedWaterfall, sameWaterfall } from '~/components/AI/savedWaterfallSelection';
import type { AiWaterfallConfig } from './waterfallConfig';
import type { SavedAiWaterfall } from './savedWaterfallCore';

const config: AiWaterfallConfig = { version: 1, entries: [
	{ endpointId: 'server:anthropic', modelId: 'claude-opus-5-5', effort: 'medium', speed: 'normal' },
	{ endpointId: 'server:openai', modelId: 'gpt-6-astra', effort: 'high', speed: 'normal' }
] };
const saved: SavedAiWaterfall = { id: 'saved', name: 'Everyday work', config, updatedAt: '2026-11-15T00:00:00Z' };

test('saved selection matches the exact contextual ordered snapshot, independent of property order', () => {
	const reordered = { version: 1 as const, entries: config.entries.map(({ endpointId, modelId, effort, speed }) => ({ speed, effort, modelId, endpointId })) };
	assert.equal(matchingSavedWaterfall(reordered, [saved]), saved);
	assert.equal(matchingSavedWaterfall(null, [saved]), undefined);
	assert.equal(matchingSavedWaterfall(config, []), undefined);
	assert.equal(sameWaterfall(config, { ...config, entries: [...config.entries].reverse() }), false);
	for (const patch of [{ endpointId: 'vault:another' }, { modelId: 'claude-opus-5' }, { effort: null }, { speed: 'fast' as const }]) {
		assert.equal(matchingSavedWaterfall({ ...config, entries: [{ ...config.entries[0], ...patch }, config.entries[1]] }, [saved]), undefined);
	}
});

test('duplicate saved snapshots choose a stable first match without conflating endpoint or default effort', () => {
	assert.equal(matchingSavedWaterfall(config, [saved, { ...saved, id: 'copy' }])?.id, 'saved');
	assert.equal(sameWaterfall({ version: 1, entries: [{ ...config.entries[0], effort: null }] }, { version: 1, entries: [{ ...config.entries[0], effort: undefined as any }] }), true);
});
