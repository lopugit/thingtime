import assert from 'node:assert/strict';
import test from 'node:test';
import { compositionReferences } from '~/api/utils/actions/sharedCompositionCore';
import { capabilitySatisfies } from '~/api/utils/capabilities/capabilityContract';
import { validateThingtimeCrystal } from '~/schemas/registry';
import {
	nextWebpageActivationBoundary, parseWebpageActivation, webpageActivationKey,
	webpageActivationQuery, stableActivationEnsureKey, WEBPAGE_ACTIVATION_REQUIREMENTS
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
		{ ...authored, action: '{query.action}' },
		{ ...authored, inputs: { day: '2026-01-01' } },
		{ ...authored, queryResult: { key: 'record.id' } },
		{ ...authored, queryResult: { selectedId: 'constructor.id' } },
		{ ...authored, cadence: 'open' }
	]) assert.equal(validateThingtimeCrystal(['webpage'], { name: 'Daily desk', blocks: [], activationAction: invalid }).ok, false);
});

test('activation uses the authored civil date and rolls across a DST-short day', () => {
	const binding = parseWebpageActivation(authored)!;
	const now = Date.parse('2026-10-03T14:00:00Z');
	const boundary = Date.parse('2026-10-04T13:00:00Z');
	assert.equal(webpageActivationKey(binding, now - 1), '2026-10-03');
	assert.equal(webpageActivationKey(binding, now), '2026-10-04');
	assert.equal(webpageActivationKey(binding, boundary), '2026-10-05');
	assert.ok(Math.abs(nextWebpageActivationBoundary(binding, now)! - boundary) <= 1000);
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
	for (const [feature, prior] of [['api.actions-run', '1.43.0'], ['api.webpages-resolve', '1.13.0']] as const) {
		const minimum = WEBPAGE_ACTIVATION_REQUIREMENTS[feature];
		assert.equal(capabilitySatisfies(prior, minimum), false);
		assert.equal(capabilitySatisfies(minimum, minimum), true);
		assert.equal(capabilitySatisfies(minimum.replace(/0$/, '1'), minimum), true);
		assert.equal(capabilitySatisfies('2.0.0', minimum), false);
	}
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
