import assert from 'node:assert/strict';
import test from 'node:test';
import { compositionReferences } from '~/api/utils/actions/sharedCompositionCore';
import { capabilitySatisfies } from '~/api/utils/capabilities/capabilityContract';
import { validateThingtimeCrystal } from '~/schemas/registry';
import {
	nextWebpageActivationBoundary, parseWebpageActivation, webpageActivationKey,
	actionActivationWriteMinimum, webpageActivationQuery, stableActivationEnsureBatch, stableActivationEnsureKey, WEBPAGE_ACTIVATION_REQUIREMENTS
} from '~/schemas/webpageActivation';
import { buildActionRunBody } from '../Actions/actionRunRequest';

const authored = {
	action: 'ensure-daily', cadence: 'day', timeZone: 'Australia/Melbourne',
	dayInput: 'day', inputs: { enabled: false, width: 0 }, queryResult: { selectedId: 'record.id' }
};
test('the webpage write gate saves only an exact, literal activation binding', () => {
	const result = validateThingtimeCrystal(['webpage'], { name: 'Daily desk', blocks: [], activationAction: authored });
	assert.ok(result.ok);
	assert.deepEqual(result.crystal.activationAction, authored);
	for (const invalid of [
		{ ...authored, timeZone: 'Unreal/Nowhere' },
		{ ...authored, cutoffTime: '24:00' },
		{ ...authored, cutoffTime: '18:30\n' },
		{ ...authored, cutoffTime: { thingId: 'settings', schemaId: 'settings-schema', field: 'cutoff.nested' } },
		{ ...authored, action: '{query.action}' },
		{ ...authored, inputs: { day: '2026-01-01' } },
		{ ...authored, queryResult: { key: 'record.id' } },
		{ ...authored, queryResult: { selectedId: 'constructor.id' } },
		{ ...authored, cadence: 'open' }
	]) assert.equal(validateThingtimeCrystal(['webpage'], { name: 'Daily desk', blocks: [], activationAction: invalid }).ok, false);
});

test('activation uses the authored civil date and rolls across a DST-short day', () => {
	const binding = { ...parseWebpageActivation(authored)!, cutoffTime: '00:00' };
	const now = Date.parse('2026-10-03T14:00:00Z');
	const boundary = Date.parse('2026-10-04T13:00:00Z');
	assert.equal(webpageActivationKey(binding, now - 1), '2026-10-03');
	assert.equal(webpageActivationKey(binding, now), '2026-10-04');
	assert.equal(webpageActivationKey(binding, boundary), '2026-10-05');
	assert.ok(Math.abs(nextWebpageActivationBoundary(binding, now)! - boundary) <= 1000);
});

test('a non-midnight cutoff advances once, including skipped and repeated local times', () => {
	const binding = { ...parseWebpageActivation(authored)!, cutoffTime: '02:30' };
	for (const [instant, before, after] of [
		['2026-11-10T15:30:00Z', '2026-11-11', '2026-11-12'],
		['2026-10-03T16:00:00Z', '2026-10-04', '2026-10-05'],
		['2026-04-04T15:30:00Z', '2026-04-05', '2026-04-06']
	]) {
		const boundary = Date.parse(instant);
		assert.equal(webpageActivationKey(binding, boundary - 1), before);
		assert.equal(webpageActivationKey(binding, boundary), after);
		assert.equal(nextWebpageActivationBoundary(binding, boundary - 1), boundary);
	}
	assert.equal(webpageActivationKey(binding, Date.parse('2026-04-04T16:05:00Z')), '2026-04-06');
});

test('activation adopts only declared scalar result paths and never sends caller inputs', () => {
	const binding = parseWebpageActivation(authored)!;
	assert.deepEqual(webpageActivationQuery(binding, { record: { id: 'route', extra: 'ignored' }, key: 'secret' }), { selectedId: 'route' });
	assert.deepEqual(webpageActivationQuery(binding, { record: { id: { route: 'bad' } } }), {});
	assert.deepEqual(webpageActivationQuery(binding, Object.create({ record: { id: 'inherited' } })), {});
	assert.deepEqual(buildActionRunBody({
		action: authored.action, source: 'activation', activationPageId: 'page',
		activationPageRevision: '2026-11-08T00:00:00.000Z', activationOnceKey: '2026-11-09', inputs: { day: 'wrong' }
	}), { action: authored.action, source: 'activation', activationPageId: 'page',
		activationPageRevision: '2026-11-08T00:00:00.000Z', activationOnceKey: '2026-11-09' });
});

test('activation negotiates both additive capabilities and rejects prior or breaking contracts', () => {
	for (const [feature, prior] of [['api.actions-run', '1.44.0'], ['api.webpages-resolve', '1.14.0']] as const) {
		const minimum = WEBPAGE_ACTIVATION_REQUIREMENTS[feature];
		assert.equal(capabilitySatisfies(prior, minimum), false);
		assert.equal(capabilitySatisfies(minimum, minimum), true);
		assert.equal(capabilitySatisfies(minimum.replace(/0$/, '1'), minimum), true);
		assert.equal(capabilitySatisfies('2.0.0', minimum), false);
	}
});

test('scheduled writes negotiate additive support and automatic batches bind only verified days', () => {
	const each = { ttExpr: ['civilDateRange', '$input.day', '$step.1.crystal.count'] };
	const steps = [{ op: 'things.ensure', key: '$item', each }];
	assert.equal(actionActivationWriteMinimum({ steps }, 'api.things'), '1.58.0');
	assert.equal(actionActivationWriteMinimum({ activationAction: authored }, 'api.things'), '1.56.0');
	assert.equal(actionActivationWriteMinimum({ activationAction: { ...authored, cutoffTime: '14:30' } }, 'api.things-update'), '1.23.0');
	assert.equal(stableActivationEnsureBatch('$item', each, 'day'), true);
	assert.equal(stableActivationEnsureBatch('$item', { ttExpr: ['civilDateRange', '$input.other', 30] }, 'day'), false);
	assert.equal(stableActivationEnsureBatch('$index', each, 'day'), false);
	assert.equal(stableActivationEnsureBatch('$item', ['2026-11-11'], 'day'), false);
});

test('automatic ensure can only use a literal identity or the bound day', () => {
	for (const key of ['per-account', '$$literal', '$input.day']) assert.equal(stableActivationEnsureKey(key, 'day'), true);
	for (const key of ['$now', '$input.other', '$step.1.value', { ttExpr: ['random'] }, { ttConcat: ['prefix-', '$input.day'] }])
		assert.equal(stableActivationEnsureKey(key, 'day'), false);
	assert.equal(stableActivationEnsureKey('$input.day'), false);
});

test('a private activation does not add a shared composition dependency', () => {
	assert.deepEqual(compositionReferences(['webpage'], {
		activationAction: authored,
		blocks: [{ id: 'display', type: 'component', component: 'editable-display' }]
	}).map(({ kind, ref }) => ({ kind, ref })), [{ kind: 'component', ref: 'editable-display' }]);
});
