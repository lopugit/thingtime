import assert from 'node:assert/strict';
import test from 'node:test';

import { apiEndpointDocs, apiRouteCapabilityId, createApiCapabilitiesManifest } from './apiDocs';
import { routeModules } from '../../server/routes/api/[...]';
import { thingtimeCapabilityManifest } from '../api/utils/capabilities/thingtimeCapabilities';

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
	assert.equal(createApiCapabilitiesManifest().features['api.admin-migrations-run'], '1.0.1');
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

	assert.equal(manifest.features['api.notifications-devices'], '1.1.0');
	assert.equal(manifest.features['api.notifications-list'], '1.3.0');
	assert.equal(manifest.features['api.watch-pairing'], '1.2.0');
	assert.equal(manifest.features['api.watch-sync'], '1.0.0');
	assert.equal(manifest.features['api.watch-things'], '1.0.0');
	assert.equal(manifest.features['api.devices'], '1.9.0');
	assert.equal(manifest.features['api.attachment-uploads'], '1.1.0');
	assert.equal(manifest.features['api.attachment-upload-parts'], '1.1.0');
	assert.equal(manifest.features['api.attachment-upload-complete'], '1.1.0');
});

test('notification contracts publish the history filters and the system family as compatible minors', () => {
	const manifest = createApiCapabilitiesManifest();

	// the history filters landed as 1.1.0; the list then took the cursor,
	// from/to window and viewer object on top, so it publishes 1.2.0
	assert.equal(manifest.features['api.notifications-list'], '1.3.0');
	assert.equal(manifest.features['api.notifications-settings'], '1.2.0');
});

test('capabilities publish the non-secret data authority used by a bundle', () => {
	const manifest = createApiCapabilitiesManifest([], {
		schemaVersion: 1,
		id: 'development',
		kind: 'development',
		federationId: 'development',
		authorityOrigin: 'https://dev.thingtime.com'
	});
	assert.equal(manifest.features['api.capabilities'], '1.1.0');
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
	assert.equal(manifest.features['api.admin-migrations'], '1.1.0');
	assert.equal(manifest.features['api.mongodb-raw-results'], '1.1.0');
});

test('the Lopu family publishes its minor capability updates (own providers, verified keys)', () => {
	const manifest = createApiCapabilitiesManifest();
	// 1.3.0: vaultProviders[].realtimeModels + the kind-default model for a row saved without one
	assert.equal(manifest.features['api.ai-models'], '1.3.0');
	assert.equal(manifest.features['api.admin-ai-models'], '1.1.0');
	assert.equal(manifest.features['api.settings-lopu-chat-defaults'], '1.1.0');
	// 1.1.1 / 1.0.1: the chat write buckets fail closed on a limiter outage
	assert.equal(manifest.features['api.lopu-chats'], '1.1.1');
	assert.equal(manifest.features['api.lopu-chats-update'], '1.1.1');
	assert.equal(manifest.features['api.lopu-chats-delete'], '1.0.1');
	// 1.2.0: server-verified confirmations (confirmations[] in, confirm event +
	// tool_result.needsConfirmation out) and the JSON-only fence (415)
	assert.equal(manifest.features['api.lopu-chats-reply'], '1.2.0');
	// 1.1.0: optional provider `model` + templates with catalog models / more kinds (vault);
	// optional per-turn model, effort, speed (voice turn) — on top of the 1.0.1 fences
	assert.equal(manifest.features['api.lopu-vault'], '1.1.0');
	assert.equal(manifest.features['api.lopu-voice-reply'], '1.1.0');
	// direct voice (§6.1): the ephemeral realtime credential
	assert.equal(manifest.features['api.lopu-voice-session'], '1.0.0');
});

test('persistent attachment content and resized previews advertise their additive contract', () => {
	assert.equal(createApiCapabilitiesManifest().features['api.attachment-content'], '1.1.0');
});

test('admin preview dispatch publishes its protected-controller contract version', () => {
	const manifest = createApiCapabilitiesManifest();
	assert.equal(manifest.features['api.admin-ci-previews'], '2.0.0');
});

test('storage-aware health and the corrected email environment gate publish their contract updates', () => {
	const manifest = createApiCapabilitiesManifest();
	assert.equal(manifest.features['api.health-nitro'], '1.1.0');
	assert.equal(manifest.features['api.email-config'], '1.0.1');
});

test('subspace lifecycle + notification type additions publish their contract versions', () => {
	const manifest = createApiCapabilitiesManifest();
	// S1 review fixes: guarded transfer writes (409 on a race — patch), and a
	// delete that keeps private/removed posts author-only, holds the slug and
	// answers { privatePosts } (additive → minor)
	// S3 review: transfer's newOwner row carries userFlair (1.1.0, additive)
	// S4: the returned subspace carries removalReasons (1.2.0, additive)
	assert.equal(manifest.features['api.subspaces-transfer'], '1.2.0');
	assert.equal(manifest.features['api.subspaces-delete'], '1.1.0');
	// S4 review: subspace-post-removed / subspace-ban rows carry the subspace's
	// mod team as their actor (1.2.0, additive)
	assert.equal(manifest.features['api.notifications-list'], '1.3.0');
	assert.equal(manifest.features['api.notifications-settings'], '1.2.0');
});

test('subspace join requests + posting-approval requests publish their contract versions', () => {
	const manifest = createApiCapabilitiesManifest();
	// S2: private join → pending request (join), leave cancels it, list/detail
	// carry viewer.pending/approvalRequested (+ mods' queue counts), members
	// grew pending=1 / approvalRequests=1 + accept / deny / request-approval
	// (S3 review: join / leave answer the subspace block with the user-flair
	// settings + viewer.userFlair — both 1.2.0, additive; S4: + removalReasons,
	// both 1.3.0)
	assert.equal(manifest.features['api.subspaces-leave'], '1.3.0');
	// S2 review: join re-requests start clean + deduped mod bells + own rate
	// key (1.1.1), decisions on a withdrawn request answer 409 / pending-row
	// walls / remove revokes approval (members 1.2.1), an access change
	// resolves the queues (update 1.1.0)
	assert.equal(manifest.features['api.subspaces-join'], '1.3.0');
});

test('subspace user flairs publish their contract versions', () => {
	const manifest = createApiCapabilitiesManifest();
	// S3: the subspace projection carries userFlairs / userFlairSelfAssign /
	// allowCustomUserFlair + viewer.userFlair (list + get 1.2.0), update takes
	// the three settings (1.2.0), members rows carry userFlair + the userFlair
	// action (1.2.1 → 1.3.0), the subspace feed's posts wear authorFlair
	// (1.1.0), and every post/comment projection carries authorFlair (things,
	// things-comment, things-feed, things-user contract 1.1.0 → 1.2.0)
	// (S4 moved list / get / update on to 1.3.0 — see the removal-reasons test;
	// S6 moved list on to 1.4.0 — sort=new|members|active)
	assert.equal(manifest.features['api.subspaces'], '1.5.0');
	// (S5 moved get on to 1.4.0 — openReportCount for moderators)
	assert.equal(manifest.features['api.subspaces-get'], '1.4.0');
	assert.equal(manifest.features['api.subspaces-update'], '1.3.0');
	// S3 review: kick / ban strip the flair, demotion strips a mod-only pick,
	// mods may dress the owner (members 1.3.1, corrections); moderate's
	// re-projected post carries authorFlair (1.1.0, additive) — S4 moved both
	// on (members 1.4.0, moderate 1.2.0, feed 1.2.0)
	// (S4 review moved members on to 1.4.1 — mod-team ban bell — and moderate
	// to 1.3.0 — ruleIndex, idempotent remove, mod-team bell headline)
	assert.equal(manifest.features['api.subspaces-members'], '1.4.1');
	// (S5 moved moderate on to 1.4.0 — remove / approve settle open reports —
	// and feed to 1.3.0 — moderators' posts carry subspaceMod.reportCount)
	assert.equal(manifest.features['api.subspaces-moderate'], '1.4.0');
	assert.equal(manifest.features['api.subspaces-feed'], '1.3.0');
	// (S5 moved the shared post projection's contract on to 1.3.0 —
	// subspaceMod.reportCount for the post's moderators; S6 moved the feed on
	// to 1.4.0 — scope=all|subspaces)
	for (const feature of ['api.things-comment', 'api.things-user']) {
		assert.equal(manifest.features[feature], '1.3.0', feature);
	}
	// (S7 moved the single read on to 1.4.0 — commentSort=top|new|old; the
	// shared projection's other three ids are untouched)
	assert.equal(manifest.features['api.things'], '1.4.0');
	assert.equal(manifest.features['api.things-feed'], '1.4.0');
});

test('subspace removal reasons + moderation modals publish their contract versions', () => {
	const manifest = createApiCapabilitiesManifest();
	// S4: the subspace projection carries removalReasons — the canned
	// { id, title, message } list (list / get / update / join / leave 1.3.0,
	// feed + transfer 1.2.0, all additive); moderate remove takes reasonId and
	// notifies the author (1.2.0, additive); ban takes a private mod-log note
	// (members 1.4.0, additive)
	for (const feature of ['api.subspaces-update', 'api.subspaces-join', 'api.subspaces-leave']) {
		assert.equal(manifest.features[feature], '1.3.0', feature);
	}
	assert.equal(manifest.features['api.subspaces'], '1.5.0'); // S6: sort=new|members|active; S6 review: anon=1 + rate key + private activity fenced
	assert.equal(manifest.features['api.subspaces-get'], '1.4.0'); // S5: openReportCount
	assert.equal(manifest.features['api.subspaces-feed'], '1.3.0'); // S5: subspaceMod.reportCount
	assert.equal(manifest.features['api.subspaces-transfer'], '1.2.0');
	// S4 review: moderate remove takes ruleIndex (a cited rule composed and
	// bounded server-side), is a no-op on an already-removed post, and the
	// author's bell comes from the mod team with the reason's headline (1.3.0,
	// additive); the ban / unban bell comes from the mod team too (members
	// 1.4.1, correction)
	assert.equal(manifest.features['api.subspaces-moderate'], '1.4.0'); // S5: settles open reports
	assert.equal(manifest.features['api.subspaces-members'], '1.4.1');
});

test('subspace reports publish their contract versions', () => {
	const manifest = createApiCapabilitiesManifest();
	// S5: POST /subspaces/report (any visible viewer flags a post / comment to
	// the mods) and GET+POST /subspaces/reports (the grouped Reports queue +
	// dismiss) are new contracts; the subspace detail carries openReportCount
	// for moderators (get 1.4.0), moderate remove / approve settle the post's
	// open reports (1.4.0), and every post projection carries
	// subspaceMod.reportCount for the post's moderators (things family 1.3.0,
	// subspaces-feed 1.3.0) — all additive. S5 review: report 1.0.1 (a removed
	// post → 409, a repeat after a move re-files in the new subspace, a deleted
	// comment takes its rows) and reports 1.0.1 (dismiss without a slug follows
	// the open rows' own targetId) — compatible corrections
	assert.equal(manifest.features['api.subspaces-report'], '1.0.1');
	assert.equal(manifest.features['api.subspaces-reports'], '1.0.1');
	assert.equal(manifest.features['api.subspaces-get'], '1.4.0');
	assert.equal(manifest.features['api.subspaces-moderate'], '1.4.0');
	assert.equal(manifest.features['api.subspaces-feed'], '1.3.0');
	for (const feature of ['api.things-comment', 'api.things-user']) {
		assert.equal(manifest.features[feature], '1.3.0', feature);
	}
	// (S7 moved the single read on to 1.4.0 — commentSort=top|new|old; the
	// shared projection's other three ids are untouched)
	assert.equal(manifest.features['api.things'], '1.4.0');
	assert.equal(manifest.features['api.things-feed'], '1.4.0'); // S6: scope
});

test('subspace discovery publishes its contract versions', () => {
	const manifest = createApiCapabilitiesManifest();
	// S6: the directory takes sort=new|members|active (members / active are
	// ranked in memory over the newest 200 matching subspaces and paged by
	// offset; rows under active carry recentPostCount; the response echoes
	// sort; an unknown sort → 400) — list 1.3.0 → 1.4.0, additive. The home
	// feed takes scope=all|subspaces (only the viewer's ACTIVE subspaces —
	// empty for guests / non-members — with every other fence intact; the
	// response echoes scope; an unknown scope → 400) — feed 1.3.0 → 1.4.0,
	// additive. The rest of the family is untouched. S6 review: list takes
	// anon=1 (the edge-cacheable logged-out view, additive), is rate-limited
	// (subspaces.list, 120/min) and fences a private subspace's activity to
	// its ACTIVE members (compatible corrections) — 1.4.0 → 1.5.0.
	assert.equal(manifest.features['api.subspaces'], '1.5.0');
	assert.equal(manifest.features['api.things-feed'], '1.4.0');
	for (const feature of ['api.things-comment', 'api.things-user']) {
		assert.equal(manifest.features[feature], '1.3.0', feature);
	}
	// (S7 moved the single read on to 1.4.0 — commentSort=top|new|old; the
	// shared projection's other three ids are untouched)
	assert.equal(manifest.features['api.things'], '1.4.0');
	assert.equal(manifest.features['api.subspaces-feed'], '1.3.0');
	assert.equal(manifest.features['api.subspaces-get'], '1.4.0');
});
