import assert from 'node:assert/strict';
import test from 'node:test';

import { apiEndpointDocs, apiRouteCapabilityId, createApiCapabilitiesManifest } from './apiDocs';
import { routeModules } from '../../server/routes/api/[...]';

test('capabilities advertise every documented semantic contract', () => {
	const manifest = createApiCapabilitiesManifest();

	for (const doc of apiEndpointDocs) {
		assert.equal(manifest.features[`api.${doc.id}`], doc.contractVersion, doc.endpoint);
	}
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
	assert.equal(manifest.features['api.notifications-list'], '1.2.0');
	assert.equal(manifest.features['api.notifications-settings'], '1.1.0');
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
	// (S4 moved list / get / update on to 1.3.0 — see the removal-reasons test)
	assert.equal(manifest.features['api.subspaces'], '1.3.0');
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
	// subspaceMod.reportCount for the post's moderators)
	for (const feature of ['api.things', 'api.things-comment', 'api.things-feed', 'api.things-user']) {
		assert.equal(manifest.features[feature], '1.3.0', feature);
	}
});

test('subspace removal reasons + moderation modals publish their contract versions', () => {
	const manifest = createApiCapabilitiesManifest();
	// S4: the subspace projection carries removalReasons — the canned
	// { id, title, message } list (list / get / update / join / leave 1.3.0,
	// feed + transfer 1.2.0, all additive); moderate remove takes reasonId and
	// notifies the author (1.2.0, additive); ban takes a private mod-log note
	// (members 1.4.0, additive)
	for (const feature of ['api.subspaces', 'api.subspaces-update', 'api.subspaces-join', 'api.subspaces-leave']) {
		assert.equal(manifest.features[feature], '1.3.0', feature);
	}
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
	// subspaces-feed 1.3.0) — all additive
	assert.equal(manifest.features['api.subspaces-report'], '1.0.0');
	assert.equal(manifest.features['api.subspaces-reports'], '1.0.0');
	assert.equal(manifest.features['api.subspaces-get'], '1.4.0');
	assert.equal(manifest.features['api.subspaces-moderate'], '1.4.0');
	assert.equal(manifest.features['api.subspaces-feed'], '1.3.0');
	for (const feature of ['api.things', 'api.things-comment', 'api.things-feed', 'api.things-user']) {
		assert.equal(manifest.features[feature], '1.3.0', feature);
	}
});
