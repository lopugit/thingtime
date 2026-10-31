import { FILE_SYNC_RESOURCE_REQUIREMENTS } from '~/fileSync/configuration';
import { fileSyncDownloadRequirements } from '~/fileSync/signedDownloadTarget';
import { MOBILE_DEVICE_REQUIREMENTS } from '../devices/platform';
import { SUBSPACE_MEDIA_REQUIREMENTS } from '../utils/subspaceMediaCapabilities';
import assert from 'node:assert/strict';
import test from 'node:test';

import { apiEndpointDocs, apiRouteCapabilityId, apiV1RouteKeys, createApiCapabilitiesManifest } from './apiDocs';
import { routeModules } from '../../server/routes/api/[...]';
import { MAPS_FEATURE, MAPS_FEATURE_VERSION } from '../schemas/maps';
import { thingtimeCapabilityManifest } from '../api/utils/capabilities/thingtimeCapabilities';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';

test('configured OpenAI credential import advertises its corrected contract on both manifests', () => {
	const feature = 'api.admin-ci-credentials';
	const versions = [
		createApiCapabilitiesManifest().features[feature],
		thingtimeCapabilityManifest('https://thingtime.test').features[feature].version
	];
	for (const version of versions) {
		assert.equal(version, '3.1.1');
		assert.equal(capabilitySatisfies(version, '3.1.1'), true);
	}
	for (const version of [undefined, '1.0.0', '3.0.0', '3.1.0', '4.0.0']) {
		assert.equal(capabilitySatisfies(version, '3.1.1'), false);
	}
	for (const version of ['3.1.2', '3.2.0']) assert.equal(capabilitySatisfies(version, '3.1.1'), true);
	assert.equal(typeof routeModules['v1/admin/ci/credentials'], 'function');
});

test('Timeline synchronization is registered and versioned on both capability manifests', () => {
	assert.equal(createApiCapabilitiesManifest().features['api.mongodb-endpoint'], '1.1.0');
	assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.mongodb-endpoint'].version, '1.1.0');
	assert.equal(createApiCapabilitiesManifest().features['api.timeline'], '1.23.0');
	assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.timeline'].version, '1.23.0');
	assert.equal(typeof routeModules['v1/timeline'], 'function');
	assert.equal(capabilitySatisfies('1.18.0','1.19.0'),false);
	assert.equal(capabilitySatisfies(createApiCapabilitiesManifest().features['api.timeline'],'1.19.0'),true);
	for (const version of [undefined, '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), false);
});

test('History settings are registered and versioned on both manifests without bumping Timeline', () => {
	assert.equal(createApiCapabilitiesManifest().features['api.timeline-settings'], '1.0.0');
	const wellKnown = thingtimeCapabilityManifest('https://thingtime.test');
	assert.equal(wellKnown.features['api.timeline-settings'].version, '1.0.0');
	assert.ok(wellKnown.operations.some((operation) => operation.feature === 'api.timeline-settings' && operation.path === '/api/v1/timeline/settings' && operation.methods.includes('GET') && operation.methods.includes('POST')));
	assert.ok(apiV1RouteKeys.includes('v1/timeline/settings'));
	assert.equal(typeof routeModules['v1/timeline/settings'], 'function');
	assert.equal(createApiCapabilitiesManifest().features['api.timeline'], '1.18.0');
	assert.equal(capabilitySatisfies(createApiCapabilitiesManifest().features['api.timeline-settings'], '1.0.0'), true);
	for (const version of [undefined, '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), false);
});

test('dedicated theme writers advertise durable history on both capability manifests', () => {
	const route = createApiCapabilitiesManifest().features;
	const wellKnown = thingtimeCapabilityManifest('https://thingtime.test').features;
	for (const [feature, version] of [['api.themes', '1.3.0'], ['api.themes-delete', '1.1.1']]) {
			assert.equal(route[feature], version);
			assert.equal(wellKnown[feature].version, version);
		assert.equal(capabilitySatisfies(route[feature], '1.1.0'), true);
		for (const version of [undefined, '1.0.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.1.0'), false);
	}
});


test('conditional theme synchronization is registered on both manifests', () => {
 const feature = 'api.themes-sync';
 assert.equal(createApiCapabilitiesManifest().features[feature], '1.8.0');
 const manifest = thingtimeCapabilityManifest('https://thingtime.test');
 assert.equal(manifest.features[feature].version, '1.8.0');
 assert.ok(manifest.operations.some(operation => operation.feature === feature && operation.path === '/api/v1/themes/sync' && operation.methods.includes('POST')));
 assert.equal(typeof routeModules['v1/themes/sync'], 'function');
});

test('JSON Action inputs and draft-saving suites negotiate both origin manifests', () => {
	const route = createApiCapabilitiesManifest().features;
	const wellKnown = thingtimeCapabilityManifest('https://thingtime.test').features;
	for (const [feature, minimum, previous] of [
		['api.things', '1.38.0', '1.32.0'], ['api.things-update', '1.13.0', '1.9.0'],
		['api.actions-run', '1.38.0', '1.35.0'], ['api.webpages-suites-install', '1.7.0', '1.6.0']
	]) {
		assert.equal(route[feature], feature === 'api.things' ? '1.42.0' : minimum);
		assert.equal(wellKnown[feature].version, feature === 'api.things' ? '1.42.0' : minimum);
		assert.equal(capabilitySatisfies(route[feature], minimum), true);
		for (const version of [undefined, previous, '2.0.0']) assert.equal(capabilitySatisfies(version, minimum), false);
	}
});

test('external avatar export requires the bounded-download contract on both manifests', () => {
  assert.equal(createApiCapabilitiesManifest().features['api.things-export'], '1.18.0');
  assert.equal(thingtimeCapabilityManifest('https://archive.test').features['api.things-export'].version, '1.18.0');
  for (const version of [undefined, '1.13.0', '1.13.9', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.14.0'), false);
  for (const version of ['1.14.0', '1.14.1', '1.15.0']) assert.equal(capabilitySatisfies(version, '1.14.0'), true);
});

test('emoji transfer, library and move capabilities reject pre-support origins', () => {
  const manifest = thingtimeCapabilityManifest('https://thingtime.test');
  for (const [feature, version] of [['api.things-export', '1.18.0'], ['api.things-import', '1.15.0'], ['api.things', '1.38.0'], ['api.things-bulk', '1.6.0']]) {
    assert.equal(manifest.features[feature].version, feature === 'api.things' ? '1.42.0' : version);
    assert.equal(capabilitySatisfies(version, version), true);
    assert.equal(capabilitySatisfies('1.0.0', version), false);
    assert.equal(capabilitySatisfies('2.0.0', version), false);
    assert.equal(capabilitySatisfies(undefined, version), false);
  }
});

test('archive root moves negotiate the additive bulk contract on both manifests', () => {
  assert.equal(createApiCapabilitiesManifest().features['api.things-bulk'], '1.6.0');
  assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.things-bulk'].version, '1.6.0');
  for (const version of [undefined, '1.3.0', '1.3.1', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.4.0'), false);
  for (const version of ['1.4.0', '1.4.1', '1.5.0']) assert.equal(capabilitySatisfies(version, '1.4.0'), true);
});

test('archive library and folder export reject origins without complete archive traversal', () => {
  const manifest = thingtimeCapabilityManifest('https://thingtime.test');
  for (const [feature, required, previous] of [['api.things', '1.38.0', '1.13.1'], ['api.things-export', '1.18.0', '1.9.0']]) {
    assert.equal(manifest.features[feature].version, feature === 'api.things' ? '1.42.0' : required);
    for (const version of [undefined, previous, '2.0.0']) assert.equal(capabilitySatisfies(version, required), false);
    assert.equal(capabilitySatisfies(required, required), true);
  }
  assert.equal(createApiCapabilitiesManifest().features['api.things'], '1.42.0');
  assert.equal(createApiCapabilitiesManifest().features['api.things-export'], '1.18.0');
});

test('archive re-export is advertised by both manifests and rejects incomplete older implementations', () => {
  assert.equal(createApiCapabilitiesManifest().features['api.things-export'], '1.18.0');
  assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.things-export'].version, '1.18.0');
  for (const version of [undefined, '1.8.0', '1.8.1', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.9.0'), false);
  for (const version of ['1.9.0', '1.9.1', '1.10.0']) assert.equal(capabilitySatisfies(version, '1.9.0'), true);
});

test('live-chat shared emoji export requires the additive contract on both manifests', () => {
  assert.equal(createApiCapabilitiesManifest().features['api.things-export'], '1.18.0');
  assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.things-export'].version, '1.18.0');
  for (const version of [undefined, '1.10.0', '1.11.0', '1.11.1', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.12.0'), false);
  for (const version of ['1.12.0', '1.12.1', '1.14.0']) assert.equal(capabilitySatisfies(version, '1.12.0'), true);
});

test('shared dependency reads negotiate the additive Things contract on both manifests', () => {
	// Preserve the newer archive contracts on top of the recording and Widgets additions.
	assert.equal(createApiCapabilitiesManifest().features['api.things'], '1.42.0');
	assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.things'].version, '1.42.0');
	assert.equal(capabilitySatisfies('1.8.2', '1.7.5'), true);
	assert.equal(capabilitySatisfies('1.8.1', '1.8.2'), false);
	assert.equal(capabilitySatisfies('1.8.3', '1.8.2'), true);
	assert.equal(createApiCapabilitiesManifest().features['api.things-update'], '1.13.0');
	assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.things-update'].version, '1.13.0');
	assert.equal(capabilitySatisfies('1.7.1', '1.7.0'), true);
	assert.equal(capabilitySatisfies('1.7.0', '1.7.1'), false);
	assert.equal(capabilitySatisfies('1.6.0', '1.5.1'), true);
	for (const unsupported of ['', '1.5.1', '2.0.0']) assert.equal(capabilitySatisfies(unsupported, '1.6.0'), false);
});

test('standalone Thing copying negotiates the additive copy contract on both manifests', () => {
	const version = createApiCapabilitiesManifest().features['api.things-fork'];
	assert.equal(version, '1.8.0');
	assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.things-fork'].version, version);
	assert.equal(capabilitySatisfies(version, '1.0.0'), true);
	for (const unsupported of ['', '1.0.0', '1.1.0', '1.1.1', '2.0.0']) assert.equal(capabilitySatisfies(unsupported, '1.2.0'), false);
	for (const unsupported of ['', '1.2.1', '1.3.0', '1.3.1', '1.3.2', '1.3.3', '2.0.0']) assert.equal(capabilitySatisfies(unsupported, '1.4.0'), false);
	assert.equal(capabilitySatisfies('1.4.1', '1.5.0'), false);
	assert.equal(capabilitySatisfies('1.5.1', '1.5.0'), true);
});

test('Data Thing controls negotiate the shared-content action contract', () => {
	assert.equal(createApiCapabilitiesManifest().features['api.actions-run'], '1.39.0');
	assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.actions-run'].version, '1.39.0');
	for (const unsupported of ['', '1.1.0', '1.2.0', '1.2.1', '2.0.0']) assert.equal(capabilitySatisfies(unsupported, '1.3.0'), false);
	assert.equal(capabilitySatisfies('1.3.1', '1.3.0'), true);
});

test('poll votes publish the shared-identity correction', () => {
	const route = createApiCapabilitiesManifest().features;
	const manifest = thingtimeCapabilityManifest('https://thingtime.test');
	assert.equal(route['api.things-vote'], '1.2.0');
	assert.equal(manifest.features['api.things-vote'].version, '1.2.0');
	assert.equal(capabilitySatisfies(route['api.things-vote'], '1.0.0'), true);
	assert.equal(capabilitySatisfies('1.0.0', '1.0.1'), false);
	assert.equal(capabilitySatisfies('2.0.0', '1.0.1'), false);
	assert.equal(capabilitySatisfies('', '1.0.1'), false);
	assert.ok(manifest.operations.some(operation => operation.feature === 'api.things-vote' && operation.path === '/api/v1/things/vote' && operation.methods.includes('POST')));
});

test('verified vault reveal is explicit on both manifests with compatible client requirements', () => {
	assert.equal(createApiCapabilitiesManifest().features['api.vault-reveal'], '1.3.0');
	const manifest = thingtimeCapabilityManifest('https://thingtime.test');
	assert.equal(manifest.features['api.vault-reveal'].version, '1.3.0');
	assert.ok(manifest.operations.some(operation => operation.feature === 'api.vault-reveal' && operation.path === '/api/v1/vault/reveal' && operation.methods.includes('POST')));
	assert.equal(capabilitySatisfies('1.1.0', '1.0.0'), true);
	assert.equal(capabilitySatisfies('2.0.0', '1.0.0'), false);
	assert.equal(capabilitySatisfies('', '1.0.0'), false);
});

test('relationship consolidation publishes compatible additive migrations on both manifests', () => {
	const route = createApiCapabilitiesManifest().features;
	const wellKnown = thingtimeCapabilityManifest('https://thingtime.test').features;
	assert.equal(route['api.admin-migrations'], '1.4.1');
	assert.equal(route['api.admin-migrations-run'], '1.4.1');
	assert.equal(wellKnown['api.admin-migrations'].version, '1.4.1');
	assert.equal(wellKnown['api.admin-migrations-run'].version, '1.4.1');
	assert.equal(route['api.embed-things'], '1.0.1');
	assert.equal(wellKnown['api.embed-things'].version, '1.0.1');
	// Existing clients retain their compatible minimum; a client requiring the
	// repaired census can reject an older origin without guessing from routes.
	assert.equal(capabilitySatisfies(route['api.admin-migrations'], '1.1.0'), true);
	assert.equal(capabilitySatisfies('1.1.0', '1.1.1'), false);
	assert.equal(capabilitySatisfies('2.0.0', '1.1.1'), false);
	assert.equal(capabilitySatisfies('', '1.1.1'), false);
});

test('capabilities advertise every documented semantic contract', () => {
	const manifest = createApiCapabilitiesManifest();

	for (const doc of apiEndpointDocs) {
		assert.equal(manifest.features[`api.${doc.id}`], doc.contractVersion, doc.endpoint);
	}
});

test('both capability manifests advertise the bounded upload v2 contract', () => {
	assert.equal(createApiCapabilitiesManifest().features['api.network-probe-upload'], '2.1.0');
	const manifest = thingtimeCapabilityManifest('https://thingtime.test');
	assert.equal(manifest.features['api.network-probe-upload'].version, '2.1.0');
	for (const feature of ['api.network-probe-ping', 'api.network-probe-download', 'api.tiers', 'api.admin-tiers']) {
		assert.equal(manifest.features[feature].version, '1.1.0');
		assert.equal(createApiCapabilitiesManifest().features[feature], '1.1.0');
	}
	assert.equal(manifest.features['api.admin-subscriptions'].version, '1.1.1');
	assert.equal(createApiCapabilitiesManifest().features['api.admin-subscriptions'], '1.1.1');
	assert.equal(createApiCapabilitiesManifest().features['api.admin-migrations-run'], '1.4.1');
	assert.ok(manifest.operations.some((operation) => operation.feature === 'api.network-probe-upload' && operation.path === '/api/v1/network-probe/upload' && operation.methods.includes('POST')));
});

test('capabilities advertise every executable API route, including undocumented routes', () => {
	const routeKeys = [...Object.keys(routeModules), 'v1/capabilities'];
	const manifest = createApiCapabilitiesManifest(routeKeys);

	for (const routeKey of routeKeys) {
		assert.match(manifest.features[apiRouteCapabilityId(routeKey)] || '', /^\d+\.\d+\.\d+$/, routeKey);
	}
});

test('account-hint privacy contracts publish their patch-level capability updates', () => {
	const manifest = createApiCapabilitiesManifest();

	assert.equal(manifest.features['api.auth-account-hints'], '1.0.1');
	assert.equal(manifest.features['api.auth-account-hints-resolve'], '1.0.1');
});

test('capabilities publish the native Apple notification device contract', () => {
	const manifest = createApiCapabilitiesManifest();

	assert.equal(manifest.features['api.notifications-devices'], '1.2.0');
	assert.equal(manifest.features['api.notifications-list'], '1.7.0');
	assert.equal(manifest.features['api.watch-pairing'], '1.2.0');
	assert.equal(manifest.features['api.watch-sync'], '1.1.0');
	assert.equal(manifest.features['api.watch-things'], '1.1.0');
	assert.equal(manifest.features['api.devices'], '1.13.0');
	assert.equal(manifest.features['api.attachment-uploads'], '1.7.0');
	assert.equal(manifest.features['api.attachment-upload-parts'], '1.1.0');
	assert.equal(manifest.features['api.attachment-upload-complete'], '1.5.1');
});

test('notification contracts publish the history filters and the system family as compatible minors', () => {
	const manifest = createApiCapabilitiesManifest();

	// Preserve both subspace notifications and private recording reminders.
	assert.equal(manifest.features['api.notifications-list'], '1.7.0');
	assert.equal(manifest.features['api.notifications-settings'], '1.7.0');
	assert.equal(manifest.features['api.things-vote'], '1.2.0');
});

test('capabilities publish the non-secret data authority used by a bundle', () => {
	const manifest = createApiCapabilitiesManifest([], {
		schemaVersion: 1,
		id: 'development',
		kind: 'development',
		federationId: 'development',
		authorityOrigin: 'https://dev.thingtime.com'
	});
	assert.equal(manifest.features['api.capabilities'], '1.2.0');
	assert.deepEqual(manifest.dataEnvironment, {
		schemaVersion: 1,
		id: 'development',
		kind: 'development',
		federationId: 'development',
		authorityOrigin: 'https://dev.thingtime.com'
	});
});

test('the storage census and ciControl workbench allowlist publish their minor capability updates', () => {
	const manifest = createApiCapabilitiesManifest();
	assert.equal(manifest.features['api.admin-migrations'], '1.4.1');
	assert.equal(manifest.features['api.mongodb-raw-results'], '1.1.1');
	assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.mongodb-raw-results'].version, '1.0.1');
});

test('packaged Claude Workflow replies publish a compatible runtime correction', () => {
  const endpoint = apiEndpointDocs.find((entry) => entry.id === 'lopu-chats-reply');
  assert.match(endpoint?.detail || '', /Version 1\.14\.2.*Claude runtime availability/);
  for (const version of [createApiCapabilitiesManifest().features['api.lopu-chats-reply'], thingtimeCapabilityManifest('https://thingtime.test').features['api.lopu-chats-reply'].version]) {
    assert.equal(version, '1.21.1');
    for (const minimum of ['1.14.0', '1.14.1', '1.14.2', '1.15.0']) assert.equal(capabilitySatisfies(version, minimum), true);
  }
  for (const unsupported of [undefined, '1.14.1', '2.0.0']) assert.equal(capabilitySatisfies(unsupported, '1.15.0'), false);
});

test('reasoning-preserving native GPT-5.6 Sol replies publish a compatible patch', () => {
  const endpoint = apiEndpointDocs.find((entry) => entry.id === 'lopu-chats-reply');
  assert.match(endpoint?.detail || '', /Version 1\.14\.1.*Responses transport/);
  for (const version of [createApiCapabilitiesManifest().features['api.lopu-chats-reply'], thingtimeCapabilityManifest('https://thingtime.test').features['api.lopu-chats-reply'].version]) {
    assert.equal(version, '1.21.1');
    assert.equal(capabilitySatisfies(version, '1.14.0'), true);
    assert.equal(capabilitySatisfies(version, '1.14.1'), true);
  }
  for (const unsupported of [undefined, '1.14.0', '2.0.0']) assert.equal(capabilitySatisfies(unsupported, '1.14.1'), false);
});

test('the Lopu family publishes its minor capability updates (own providers, verified keys)', () => {
	const manifest = createApiCapabilitiesManifest();
	// 1.3.0: vaultProviders[].realtimeModels + the kind-default model for a row saved without one;
	// 1.4.0: models[].pricing (list price per million tokens, verified-access design note §2)
	assert.equal(manifest.features['api.ai-models'], '1.8.0');
	assert.equal(manifest.features['api.admin-ai-models'], '1.4.0');
	assert.equal(manifest.features['api.settings-lopu-chat-defaults'], '1.1.0');
	// 1.1.1 / 1.0.1: the chat write buckets fail closed on a limiter outage;
	// 1.2.0 (create): the verified-access gate (403 LOPU_UNVERIFIED / 402 LOPU_NO_CREDITS, guests 403)
	assert.equal(manifest.features['api.lopu-chats'], '1.7.0');
	assert.equal(manifest.features['api.lopu-chats-update'], '1.6.1');
	assert.equal(manifest.features['api.lopu-chats-delete'], '1.1.0');
	// 1.2.0: server-verified confirmations (confirmations[] in, confirm event +
	// tool_result.needsConfirmation out) and the JSON-only fence (415);
	// 1.3.0: the verified-access gate + billing / usage / costMicros / balanceMicros on meta, done and the persisted turn;
	// 1.4.0: the in-flight cap — a billed turn holds one of at most three slots on the account, past which
	// the request is refused 429 LOPU_TURN_IN_FLIGHT (+ Retry-After) before anything is persisted
	assert.equal(manifest.features['api.lopu-chats-reply'], '1.21.1');
	assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.lopu-chats-reply'].version, '1.21.1');
	assert.equal(capabilitySatisfies('1.6.2', '1.6.1'), true);
	for (const unsupported of ['', '1.6.1', '2.0.0']) assert.equal(capabilitySatisfies(unsupported, '1.6.2'), false);
	// 1.1.0: optional provider `model` + templates with catalog models / more kinds (vault);
	// optional per-turn model, effort, speed (voice turn) — on top of the 1.0.1 fences;
	// 1.2.0 (voice reply): the gate on conversation turns + billing/usage/costMicros on done
	assert.equal(manifest.features['api.lopu-vault'], '1.4.0');
	assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.lopu-vault'].version, '1.4.0');
	assert.equal(manifest.features['api.lopu-voice-reply'], '1.4.0');
	// direct voice (§6.1): the ephemeral realtime credential; 1.1.0: the gate + a usage row per session
	assert.equal(manifest.features['api.lopu-voice-session'], '1.2.0');
});

test('the Lopu verified-access and credits family publishes its contracts', () => {
	const manifest = createApiCapabilitiesManifest();
	for (const feature of [
		'api.admin-users-lopu-access',
		'api.settings-lopu-access',
		'api.lopu-account',
		'api.lopu-account-history',
		'api.lopu-account-topup-request',
		'api.admin-lopu-accounts',
		'api.admin-lopu-credits'
	]) {
		assert.equal(manifest.features[feature], '1.0.0', feature);
	}
});

test('persistent attachment content and resized previews advertise their additive contract', () => {
	assert.equal(createApiCapabilitiesManifest().features['api.attachment-content'], '1.18.0');
	assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.attachment-content'].version, '1.18.0');
	for (const unsupported of ['', '1.1.1', '1.2.1', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '2.0.0']) assert.equal(capabilitySatisfies(unsupported, '1.6.1'), false);
	assert.equal(capabilitySatisfies('1.6.1', '1.6.1'), true);
	assert.equal(capabilitySatisfies('1.6.2', '1.6.1'), true);
});

test('shared audience-boundary corrections reject pre-fix and incompatible origins', () => {
	const manifest = thingtimeCapabilityManifest('https://thingtime.test');
	for (const [name, required, previous] of [
		['things', '1.18.0', '1.15.0'], ['things-update', '1.2.6', '1.2.5'],
		['actions-run', '1.3.1', '1.3.0'], ['things-fork', '1.4.0', '1.3.3'], ['attachment-content', '1.7.0', '1.6.4']
	]) {
		assert.equal(capabilitySatisfies(manifest.features[`api.${name}`].version, required), true);
		assert.equal(capabilitySatisfies(required, required), true);
		for (const version of ['', previous, '2.0.0']) assert.equal(capabilitySatisfies(version, required), false);
	}
});

test('admin preview dispatch publishes its protected-controller contract version', () => {
	const manifest = createApiCapabilitiesManifest();
	assert.equal(manifest.features['api.admin-ci-previews'], '2.0.0');
});

test('storage-aware health and the corrected email environment gate publish their contract updates', () => {
	const manifest = createApiCapabilitiesManifest();
	assert.equal(manifest.features['api.health-nitro'], '1.3.0');
	assert.equal(manifest.features['api.lopu-recordings-run'], '1.6.0');
	assert.equal(manifest.features['api.email-config'], '1.0.1');
});

test('marketing publishing publishes its public read and admin write contracts', () => {
	const manifest = createApiCapabilitiesManifest(Object.keys(routeModules));
	assert.equal(manifest.features['api.marketing-publications'], '1.0.0');
	assert.equal(manifest.features['api.admin-marketing-publications'], '1.0.0');
	assert.match(manifest.features[apiRouteCapabilityId('v1/marketing/publications')] || '', /^\d+\.\d+\.\d+$/);
	assert.match(manifest.features[apiRouteCapabilityId('v1/admin/marketing/publications')] || '', /^\d+\.\d+\.\d+$/);
});
