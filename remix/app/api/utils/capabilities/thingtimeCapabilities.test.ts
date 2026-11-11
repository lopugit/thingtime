import { LIBRARY_ARCHIVE_READ_REQUIREMENTS } from '~/schemas/libraryArchive';
import { EXPANDED_WEBPAGE_AUTHORING_REQUIREMENTS } from '../../../schemas/cssDeclarationNames';
import { COMPONENT_ARGUMENT_BINDING_REQUIREMENTS } from '../../../schemas/authoredControls';
import assert from 'node:assert/strict';
import test from 'node:test';

import { SHARED_CONTENT_REQUIREMENTS } from '../../../utils/sharedContentCapabilities';
import { apiEndpointDocs, apiV1DocsRouteKeys, apiV1RouteKeys, createApiCapabilitiesManifest } from '../../../docs/apiDocs';
import { capabilitySatisfies } from './capabilityContract';
import { THINGTIME_CAPABILITY_MANIFEST_PATH, thingtimeCapabilityManifest } from './thingtimeCapabilities';

test('Character profile synchronization publishes matching actor-aware route contracts', () => {
  const origin = thingtimeCapabilityManifest('https://characters.example');
  const routes = createApiCapabilitiesManifest();
  for (const [kind, version, previous] of [['themes', '1.8.0', '1.6.0'], ['algorithms', '1.6.0', '1.4.0']]) {
    const feature = `api.${kind}-sync`;
    assert.equal(origin.features[feature].version, version);
    assert.equal(routes.features[feature], version);
    assert.ok(origin.operations.some(operation => operation.feature === feature && operation.path === `/api/v1/${kind}/sync` && operation.methods.includes('POST')));
    assert.equal(capabilitySatisfies(previous, version), false);
    assert.equal(capabilitySatisfies(undefined, version), false);
    assert.equal(capabilitySatisfies('2.0.0', version), false);
    assert.equal(capabilitySatisfies(version.replace(/0$/, '1'), version), true);
  }
});

test('owner-scoped search advertises and negotiates the same additive contract on both manifests', () => {
  assert.equal(createApiCapabilitiesManifest().features['api.things-search'], '1.8.0');
  assert.equal(thingtimeCapabilityManifest('https://search.test').features['api.things-search'].version, '1.8.0');
  for (const version of [undefined, '1.3.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.4.0'), false);
  assert.equal(capabilitySatisfies('1.4.1', '1.4.0'), true);
});

test('parent argument bindings publish and negotiate matching additive contracts on both manifests', () => {
	assert.equal(COMPONENT_ARGUMENT_BINDING_REQUIREMENTS['api.things'], '1.63.0');
	const source = createApiCapabilitiesManifest();
	const runtime = thingtimeCapabilityManifest('https://bindings.example');
	for (const [feature, minimum] of Object.entries(COMPONENT_ARGUMENT_BINDING_REQUIREMENTS)) {
		assert.equal(capabilitySatisfies(source.features[feature], minimum), true);
		assert.equal(capabilitySatisfies(runtime.features[feature].version, minimum), true);
		assert.equal(capabilitySatisfies(minimum, minimum), true);
		assert.equal(capabilitySatisfies(undefined, minimum), false);
		assert.equal(capabilitySatisfies('2.0.0', minimum), false);
	}
});

test('automatic previews publish the additive social-card contract on both manifests', () => {
  assert.equal(createApiCapabilitiesManifest().features['api.social-card'], '1.4.0');
  assert.equal(thingtimeCapabilityManifest('https://invite.test').features['api.social-card'].version, '1.4.0');
  for (const version of ['1.4.0', '1.4.1', '1.5.0']) assert.equal(capabilitySatisfies(version, '1.4.0'), true);
  for (const version of ['', '1.3.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.4.0'), false);
});

test('complete emoji combinations publish corrected contracts on both manifests', () => {
  const source = createApiCapabilitiesManifest();
  const runtime = thingtimeCapabilityManifest('https://emoji.test');
  for (const [feature, minimum, previous] of [
    ['api.things-react', '1.2.1', '1.2.0'], ['api.chats-react', '1.0.3', '1.0.2'],
    ['api.things', '1.64.0', '1.46.1'], ['api.things-update', '1.27.0', '1.15.0'],


    ['api.schemas', '1.2.0', '1.1.0']
  ]) {
    assert.equal(source.features[feature], feature === 'api.things' ? '1.64.0' : minimum);
    assert.equal(runtime.features[feature]?.version, feature === 'api.things' ? '1.64.0' : minimum);

    assert.equal(capabilitySatisfies(minimum, minimum), true);
    for (const incompatible of [undefined, previous, '2.0.0']) assert.equal(capabilitySatisfies(incompatible, minimum), false);
    assert.equal(capabilitySatisfies(`${minimum.split('.').slice(0, 2).join('.')}.99`, minimum), true);
    assert.ok(runtime.operations.some((operation) => operation.feature === feature));
  }
});

test('shared deferred accounting contract is independently negotiated on both manifests', () => {
  assert.equal(createApiCapabilitiesManifest().features['api.storage-accounting'], '1.0.0');
  assert.equal(thingtimeCapabilityManifest('https://storage.test').features['api.storage-accounting'].version, '1.0.0');
  for (const version of ['1.0.0', '1.0.1', '1.1.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), true);
  for (const version of [undefined, '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), false);
});

test('archive import clients reject missing, pre-archive and breaking contracts on both manifests', () => {
  for (const version of ['1.9.1', '1.9.2', '1.10.0']) assert.equal(capabilitySatisfies(version, '1.9.1'), true);
  for (const version of ['', '1.8.0', '1.9.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.9.1'), false);
  assert.equal(createApiCapabilitiesManifest().features['api.things-import'], '1.15.0');
  assert.equal(thingtimeCapabilityManifest('https://preview.example.test').features['api.things-import'].version, '1.15.0');
});

test('owner archive deletion requires the additive Things capability at the chosen origin', () => {
  for (const version of ['1.12.0', '1.12.1', '1.14.0']) assert.equal(capabilitySatisfies(version, '1.12.0'), true);
  for (const version of ['', '1.11.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.12.0'), false);
  const origin = 'https://preview.example.test';
  const manifest = thingtimeCapabilityManifest(origin);
  assert.equal(manifest.origin, origin);
  assert.equal(manifest.features['api.things'].version, '1.64.0');
  assert.equal(createApiCapabilitiesManifest().features['api.things'], '1.64.0');


});

test('archive history readers require the selected origin to support the private snapshot contract', () => {
  for (const version of ['1.13.1', '1.13.2', '1.14.0']) assert.equal(capabilitySatisfies(version, '1.13.1'), true);
  for (const version of ['', '1.13.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.13.1'), false);
  assert.equal(createApiCapabilitiesManifest().features['api.things'], '1.64.0');
  assert.equal(thingtimeCapabilityManifest('https://archive.test').features['api.things'].version, '1.64.0');


});

test('archive emoji readers reject origins without private moderation-aware image projection', () => {
  for (const version of ['', '1.15.0', '1.15.9', '1.16.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.16.1'), false);
  for (const version of ['1.16.1', '1.16.2', '1.17.1']) assert.equal(capabilitySatisfies(version, '1.16.1'), true);
  assert.equal(thingtimeCapabilityManifest('https://archive.test').features['api.things'].version, '1.64.0');
  assert.equal(createApiCapabilitiesManifest().features['api.things'], '1.64.0');


});

test('archive gallery readers reject origins without moderation-aware media projection', () => {
  for (const version of ['', '1.13.1', '1.14.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.15.0'), false);
  for (const version of ['1.15.0', '1.16.0', '1.16.0']) assert.equal(capabilitySatisfies(version, '1.15.0'), true);
  assert.equal(thingtimeCapabilityManifest('https://archive.test').features['api.things'].version, '1.64.0');
  assert.equal(createApiCapabilitiesManifest().features['api.things'], '1.64.0');


});

test('Messenger custom-emoji parsing and projections publish a compatible correction on both manifests', () => {
  const source = createApiCapabilitiesManifest();
  const origin = thingtimeCapabilityManifest('https://emoji.test');
  for (const feature of ['api.chats-messages', 'api.chats-messages-edit', 'api.chats-react']) {
    const expected = feature === 'api.chats-messages' ? '1.6.0' : feature === 'api.chats-messages-edit' ? '1.3.0' : feature === 'api.chats-react' ? '1.0.3' : '1.0.2';
    assert.equal(source.features[feature], expected); assert.equal(origin.features[feature].version, expected);
    assert.equal(capabilitySatisfies('1.0.0', '1.0.1'), false);
    assert.equal(capabilitySatisfies('1.0.2', '1.0.1'), true);
    assert.equal(capabilitySatisfies('2.0.0', '1.0.1'), false);
    assert.equal(capabilitySatisfies(undefined, '1.0.1'), false);
  }
});

test('managed-folder transfer clients reject old and breaking import/export contracts', () => {
  for (const version of ['1.7.0', '1.7.1', '1.8.0']) assert.equal(capabilitySatisfies(version, '1.7.0'), true);
  for (const version of ['1.0.1', '1.5.0', '1.6.0', '1.6.1', '2.0.0', '']) assert.equal(capabilitySatisfies(version, '1.7.0'), false);
});

test('recording import upload requirements cover start and completion lifecycle versions', () => {
  const manifest = thingtimeCapabilityManifest('https://preview.example.test');
  for (const feature of ['api.attachment-uploads', 'api.attachment-upload-complete']) {
    assert.equal(capabilitySatisfies(manifest.features[feature]?.version, '1.3.0'), true);
    for (const version of ['1.3.0', '1.3.1', '1.4.0']) assert.equal(capabilitySatisfies(version, '1.3.0'), true);
    for (const version of ['', '1.2.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.3.0'), false);
  }
});

test('Thingtime capability manifest is origin scoped and covers the generated API route map', () => {
  const manifest = thingtimeCapabilityManifest('https://preview.example.test/path');
  assert.equal(manifest.origin, 'https://preview.example.test');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.features['api.passwords']?.version, '1.10.0');
  assert.equal(createApiCapabilitiesManifest().features['api.passwords'], '1.10.0');
  assert.equal(capabilitySatisfies('1.6.1', '1.6.1'), true);
  assert.equal(capabilitySatisfies('1.6.2', '1.6.1'), true);
  for (const version of [undefined, '1.6.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.6.1'), false);
  assert.equal(capabilitySatisfies('1.2.0', '1.3.0'), false);
  assert.equal(manifest.features['api.apps-public']?.version, '1.1.0');
  assert.equal(manifest.features['api.oauth-scopes']?.version, '1.1.0');
  for (const feature of ['api.oauth-desktop-authorize', 'api.oauth-token']) {
    assert.equal(manifest.features[feature]?.version, '1.2.0');
  }
	assert.equal(manifest.features['api.webpages-resolve']?.version, '1.19.0');

	assert.equal(manifest.features['api.actions-run']?.version, '1.46.0');
	assert.equal(manifest.features['api.things-fork']?.version, '1.8.1');
	assert.equal(manifest.features['api.things-import']?.version, '1.15.0');
	assert.equal(manifest.features['api.things-export']?.version, '1.18.0');
	assert.equal(manifest.features['api.devices-node-state']?.version, '1.15.1');

	assert.equal(capabilitySatisfies('1.9.0', '1.10.0'), false);
	assert.equal(capabilitySatisfies('1.11.0', '1.10.0'), true);
  for (const [feature, required, previous] of [['api.things-export', '1.18.0', '1.13.0'], ['api.attachment-content', '1.20.0', '1.6.4']]) {
    assert.equal(manifest.features[feature]?.version, required);
    assert.equal(capabilitySatisfies(required, required), true);
    assert.equal(capabilitySatisfies(previous, required), false);
    assert.equal(capabilitySatisfies('2.0.0', required), false);
  }
  assert.equal(manifest.features['api.things-bulk']?.version, '1.9.0');
  for (const version of ['1.2.0', '1.2.1', '1.3.0']) assert.equal(capabilitySatisfies(version, '1.2.0'), true);
  for (const version of ['1.0.0', '1.1.0', '1.1.1', '2.0.0', '']) assert.equal(capabilitySatisfies(version, '1.2.0'), false);
  assert.equal(capabilitySatisfies('1.2.0', '1.3.0'), false);
  assert.equal(capabilitySatisfies('1.3.0', '1.3.0'), true);
  assert.equal(capabilitySatisfies('1.4.0', '1.3.0'), true);
  assert.equal(capabilitySatisfies('2.0.0', '1.3.0'), false);
  assert.equal(manifest.features['api.admin-migrations-run']?.version, '1.5.0');
  assert.equal(manifest.features['api.admin-subscriptions']?.version, '1.1.1');
	assert.equal(manifest.features['api.admin-ci-dispatch']?.version, '2.2.0');
  assert.equal(manifest.features['api.admin-ci-control']?.version, '1.0.2');
  assert.equal(manifest.features['api.admin-ci-credentials']?.version, '3.1.0');
  assert.equal(manifest.features['api.admin-ci-feature-stacks']?.version, '1.4.0');
  assert.equal(manifest.features['api.admin-ci-previews']?.version, '2.0.0');
  assert.equal(manifest.features['api.auth-passkeys-register-options']?.version, '1.2.0');
  assert.equal(manifest.features['api.auth-passkeys-login-options']?.version, '1.1.0');
  assert.equal(manifest.features['api.email-config']?.version, '1.0.1');
  assert.equal(manifest.features['api.health-nitro']?.version, '1.3.0');
  assert.equal(manifest.features['api.lopu-recordings-run']?.version, '1.6.0');
  assert.equal(manifest.features['api.health-mongodb']?.version, '1.0.2');
  for (const feature of ['api.mongodb-status', 'api.mongodb-status-data']) {
    assert.equal(manifest.features[feature]?.version, '1.0.1');
  }
  assert.equal(manifest.features['api.integration-ci-credentials']?.version, '1.1.1');
  assert.equal(manifest.features['api.integration-ci-progress']?.version, '1.0.0');
  assert.equal(manifest.features['api.things-search']?.version, '1.8.0');
  assert.equal(manifest.features['api.things-share']?.version, '1.5.0');
  assert.equal(manifest.features['api.users-profile']?.version, '1.2.0');
  // subspaces + up/down votes: posts/comments gained title/subspace/flair/
  // subspaceMod/votes and the feeds honour subspace fences (1.2.0, additive);
  // round 2 S3 — user flairs: posts + comments carry authorFlair, the
  // author's user flair in the post's subspace (1.3.0, additive)
  // round 2 S5 — reports: a subspace post's subspaceMod.reportCount for its
  // moderators (1.4.0, additive)
  for (const feature of ['api.things-comment', 'api.things-user']) {
    assert.equal(manifest.features[feature]?.version, feature === 'api.things-comment' ? '1.12.0' : '1.9.0', feature);
  }
  // round 2 S7 — comment sort: GET /api/v1/things?id= takes commentSort=
  // top|new|old (the shipped comment page in Reddit's three orders; the
  // response echoes it; unknown → 400) — the single read only, the shared
  // projection is untouched (1.5.0, additive)
  // Included dependency reads add sharedRoot without widening standalone ACLs.
  // Includes completed recording attachments and portable archive library reads.
  assert.equal(manifest.features['api.things']?.version, '1.64.0');


  assert.equal(manifest.features['api.lopu-reminders']?.version, '1.1.0');
  assert.equal(manifest.features['api.lopu-voice-reply']?.version, '1.5.0');
  assert.equal(manifest.features['api.lopu-recordings-run']?.version, '1.6.0');
  assert.equal(manifest.features['api.lopu-recordings-personal']?.version, '1.1.0');
  assert.equal(manifest.features['api.notifications-test']?.version, '1.2.0');
  assert.equal(manifest.features['api.attachment-content']?.version, '1.20.0');
  // round 2 S6 — discovery: the home feed takes scope=all|subspaces ("My
  // subspaces" — only the viewer's ACTIVE subspaces, empty for guests) and
  // echoes it (1.5.0, additive)
  assert.equal(manifest.features['api.things-feed']?.version, '1.10.0');
  assert.equal(manifest.features['api.subspaces-modlog']?.version, '1.0.0');
  assert.equal(manifest.features['api.things-updown']?.version, '1.2.0');
  // S5: the report endpoint + the mods' Reports queue are new contracts;
  // S5 review moved both to 1.0.1 — a removed post takes no report (409), a
  // repeat after a move re-files in the new subspace, a deleted comment
  // takes its report rows; dismiss without a slug follows the open rows'
  // own targetId (compatible corrections)
  for (const feature of ['api.subspaces-report', 'api.subspaces-reports']) {
    assert.equal(manifest.features[feature]?.version, '1.0.1', feature);
  }
  // S3 review: moderate's re-projected post carries authorFlair (1.1.0, additive)
  // round 2 S4 — removal reasons: remove takes reasonId (a canned reason →
  // the composed stored reason) and notifies the author (1.2.0, additive)
  // S4 review: remove takes ruleIndex (a cited rule, composed server-side),
  // is idempotent on a removed post, and the author's bell comes from the
  // mod team with the reason's headline (1.3.0, additive)
  // S5: remove / approve settle the post's open reports; the re-projected
  // post carries reportCount for mods (1.4.0, additive)
  assert.equal(manifest.features['api.subspaces-moderate']?.version, '1.4.0');
  // round 2 S2 — join requests + posting-approval requests: private join
  // files a request (join 1.1.0), leave cancels it (1.1.0), the list rows /
  // detail carry viewer.pending + approvalRequested and mods get the queue
  // sizes (subspaces + get 1.1.0), and members grew the two queues + accept /
  // deny / request-approval (1.1.0 → 1.2.0; 1.1.0 was the role/ban notify)
  // S3 review: join / leave answer the subspace block with the user-flair
  // settings + viewer.userFlair (1.2.0, additive)
  // S4: the subspace block carries removalReasons (leave / join 1.3.0, additive)
  assert.equal(manifest.features['api.subspaces-leave']?.version, '1.4.0');
  // round 2 S3 — user flairs: the subspace projection carries userFlairs /
  // userFlairSelfAssign / allowCustomUserFlair + viewer.userFlair (list + get
  // 1.2.0), update takes the three settings (1.2.0), members rows carry
  // userFlair + the userFlair action (1.3.0), the subspace feed's posts wear
  // authorFlair (1.1.0) — all additive
  // round 2 S4 — removal reasons: the subspace projection carries
  // removalReasons (list / get 1.3.0), update takes the list (1.3.0) — additive
  // round 2 S5 — reports: moderators get openReportCount on the detail (get
  // 1.4.0, additive)
  // round 2 S6 — discovery: the directory takes sort=new|members|active
  // (members / active ranked over a bounded window, rows under active carry
  // recentPostCount, the response echoes sort) (list 1.4.0, additive)
  // S6 review: list takes anon=1 (the edge-cacheable logged-out view,
  // additive), is rate-limited (subspaces.list) and fences a private
  // subspace's activity to its members (compatible corrections) — 1.5.0
  assert.equal(manifest.features['api.subspaces']?.version, '1.7.0');
  assert.equal(manifest.features['api.subspaces-update']?.version, '1.6.0');
  assert.equal(manifest.features['api.subspaces-get']?.version, '1.7.0');
  // S3 review: kick / ban strip the flair, demotion strips a mod-only pick,
  // mods may dress the owner (members 1.3.1, corrections)
  // S4: ban takes a private mod-log `note` (members 1.4.0, additive)
  // S4 review: the ban / unban bell comes from the mod team (1.4.1, correction)
  assert.equal(manifest.features['api.subspaces-members']?.version, '1.4.1');
  // S4: the feed's subspace block carries removalReasons (1.2.0, additive)
  // S5: moderators' posts carry subspaceMod.reportCount (1.3.0, additive)
  assert.equal(manifest.features['api.subspaces-feed']?.version, '1.4.0');
  // S2 review: a re-request starts from a clean row + the mods' bell is
  // deduped + join has its own rate key (join 1.1.1, corrections); decisions
  // on a withdrawn request answer 409, unrelated actions on a pending row
  // 400/404, remove revokes approval (members 1.2.1, corrections); an access
  // change resolves the request queues and tells the requesters (update
  // 1.1.0, additive side effect)
  assert.equal(manifest.features['api.subspaces-join']?.version, '1.4.0');
  // S1 review: transfer's writes are guarded (a racing transfer answers 409 —
  // compatible correction); delete answers { privatePosts } beside
  // releasedPosts, holds the slug for its previous owner and refuses (409)
  // rather than strand posts behind a missing doc (additive)
  // S3 review: transfer's newOwner row carries userFlair (1.1.0, additive)
  // S4: the returned subspace carries removalReasons (1.2.0, additive)
  assert.equal(manifest.features['api.subspaces-transfer']?.version, '1.3.0');
  assert.equal(manifest.features['api.subspaces-delete']?.version, '1.3.0');
  // S4 review: post-removed / ban rows carry the subspace's mod team as actor (1.2.0, additive)
  assert.equal(manifest.features['api.notifications-list']?.version, '1.8.0');
  assert.equal(manifest.features['api.notifications-settings']?.version, '1.8.0');
  assert.equal(manifest.features['api.notifications-record']?.version, '1.0.0');
  assert.equal(manifest.features['api.things-update']?.version, '1.27.0');

  assert.equal(manifest.features['api.devices-pairing']?.version, '1.1.0');
  assert.ok(manifest.operations.some((operation) => operation.path === THINGTIME_CAPABILITY_MANIFEST_PATH));
  const operationPaths = new Set(manifest.operations.map((operation) => operation.path));
  for (const route of apiV1RouteKeys) assert.equal(operationPaths.has(`/api/${route}`), true, route);
  for (const route of apiV1DocsRouteKeys) assert.equal(operationPaths.has(`/api/${route}`), true, route);
  for (const doc of apiEndpointDocs) {
    assert.ok(manifest.features[`api.${doc.id}`], doc.id);
		assert.ok(
			manifest.operations.some((operation) => operation.feature === `api.${doc.id}` && operation.path === doc.endpoint),
			doc.endpoint
		);
  }
});

test('capability negotiation accepts compatible updates and rejects missing or breaking versions', () => {
  assert.equal(capabilitySatisfies('1.1.0', '1.1.0'), true);
  assert.equal(capabilitySatisfies('1.4.2', '1.1.0'), true);
  assert.equal(capabilitySatisfies('1.0.9', '1.1.0'), false);
  assert.equal(capabilitySatisfies('2.0.0', '1.1.0'), false);
  assert.equal(capabilitySatisfies('', '1.1.0'), false);
});

test('AI archive clients require the presentation contract before import, export and history reads', () => {
  const manifest = thingtimeCapabilityManifest('https://archive.test');
  for (const [feature, required, previous] of [['api.things-export', '1.18.0', '1.12.0'],
    ['api.things-import', '1.15.0', '1.9.1'], ['api.things', '1.64.0', '1.16.1']]) {


    assert.equal(manifest.features[feature].version, required);
    assert.equal(capabilitySatisfies(required, required), true);
    for (const unsupported of ['', previous, '2.0.0']) assert.equal(capabilitySatisfies(unsupported, required), false);
  }
});

test('the Lopu catalog family publishes its verified-provider-key minor updates', () => {
  const manifest = thingtimeCapabilityManifest('https://thingtime.test');
  // 1.4.0: models[].pricing (verified-access design note §2)
  assert.equal(manifest.features['api.ai-models']?.version, '1.9.0');
  assert.equal(manifest.features['api.admin-ai-models']?.version, '1.4.0');
  assert.equal(manifest.features['api.settings-lopu-chat-defaults']?.version, '1.1.0');
  // own providers (design note §1.3): providerId on create / update / reply;
  // 1.1.1 = the write buckets fail closed, 1.2.0 = server-verified confirmations;
  // then the verified-access gate + accounting fields (create 1.2.0, reply 1.3.0),
  // and reply 1.4.0 = the in-flight cap (429 LOPU_TURN_IN_FLIGHT past three billed turns at once)
  assert.equal(manifest.features['api.lopu-chats']?.version, '1.7.0');
  assert.equal(manifest.features['api.lopu-chats-update']?.version, '1.6.1');
  assert.equal(manifest.features['api.lopu-chats-reply']?.version, '1.23.2');
  // verified access + credits (design note "Lopu verified access, usage accounting and credits")
  for (const feature of ['api.admin-users-lopu-access', 'api.settings-lopu-access', 'api.lopu-account', 'api.lopu-account-history', 'api.lopu-account-topup-request', 'api.admin-lopu-accounts', 'api.admin-lopu-credits']) {
    assert.equal(manifest.features[feature]?.version, '1.0.0', feature);
  }
});

test('historical Lopu receipts advertise a compatible reply patch on both manifests', () => {
  for (const version of [
    thingtimeCapabilityManifest('https://thingtime.test').features['api.lopu-chats-reply'].version,
    createApiCapabilitiesManifest().features['api.lopu-chats-reply']
  ]) {
    assert.equal(version, '1.23.2');
    assert.equal(capabilitySatisfies(version, '1.6.0'), true);
    assert.equal(capabilitySatisfies(version, '1.6.1'), true);
    assert.equal(capabilitySatisfies('1.6.0', '1.6.1'), false);
    assert.equal(capabilitySatisfies('2.0.0', '1.6.1'), false);
    assert.equal(capabilitySatisfies('', '1.6.1'), false);
  }
});

test('both manifests publish passkey concurrency and Apple association contracts', () => {
  const originManifest = thingtimeCapabilityManifest('https://thingtime.com');
  const apiManifest = createApiCapabilitiesManifest();
  for (const operation of ['login-options', 'login', 'register-options', 'register'] as const) {
    const feature = `api.auth-passkeys-${operation}`;
    const expected = operation === 'login-options' ? '1.1.0' : operation === 'login' ? '1.3.1' : '1.2.0';
    assert.equal(originManifest.features[feature]?.version, expected);
    assert.equal(apiManifest.features[feature], expected);
  }
  assert.equal(originManifest.features['api.apple-app-association']?.version, '1.0.0');
  assert.equal(apiManifest.features['api.apple-app-association'], '1.0.0');
  assert.ok(originManifest.operations.some((operation) => operation.path === '/.well-known/apple-app-site-association'));
  assert.ok(originManifest.operations.some((operation) => operation.path === '/.well-known/apple-app-site-association-docs'));
});

test('both manifests publish notification history and system notification contracts', () => {
  const originManifest = thingtimeCapabilityManifest('https://thingtime.com');
  const apiManifest = createApiCapabilitiesManifest();
  // Both subspace moderation and private recording reminders are preserved.
  const expected: Record<string, string> = {
    'api.notifications-list': '1.8.0',
    'api.notifications-settings': '1.8.0'
  };
  for (const [feature, version] of Object.entries(expected)) {
    assert.equal(originManifest.features[feature]?.version, version);
    assert.equal(apiManifest.features[feature], version);
  }
});


test('native recording uploads negotiate durable private Things before sending bytes', () => {
  const manifest = thingtimeCapabilityManifest('https://thingtime.com');
  for (const feature of ['api.attachment-uploads', 'api.attachment-upload-complete']) {
    assert.equal(capabilitySatisfies(manifest.features[feature]?.version, '1.3.0'), true);
    assert.equal(capabilitySatisfies(manifest.features[feature].version, '1.2.0'), true);
    assert.equal(capabilitySatisfies('1.1.0', '1.2.0'), false);
    assert.equal(capabilitySatisfies('2.0.0', '1.2.0'), false);
  }
});

test('saved AI waterfall library is an explicit versioned capability', () => {
	const manifest = thingtimeCapabilityManifest('https://thingtime.com');
	assert.equal(manifest.features['api.ai-waterfalls']?.version, '1.0.0');
});

test('System vault and deployment reveal contracts are registered and negotiated', () => {
  const manifest = thingtimeCapabilityManifest('https://preview.example.test');
  assert.ok(apiV1RouteKeys.includes('v1/admin/system/environment'));
  assert.equal(manifest.features['api.admin-system-environment'].version, '1.0.0');
  assert.equal(manifest.features['api.admin-ci-credentials'].version, '3.1.0');
  assert.equal(manifest.features['api.vault-reveal'].version, '1.3.0');
  assert.equal(capabilitySatisfies('1.0.0', '1.1.0'), false);
  assert.equal(capabilitySatisfies('1.1.1', '1.1.0'), true);
  assert.equal(capabilitySatisfies('2.0.0', '1.1.0'), false);
  assert.equal(capabilitySatisfies(undefined, '1.1.0'), false);
});


test('algorithm discovery and geographic clients negotiate additive features', () => {
  const manifest = thingtimeCapabilityManifest('https://algorithms.test');
  const requirements = { 'api.algorithms-search': '1.0.0', 'api.algorithms': '1.1.0', 'api.algorithms-update': '1.1.0', 'api.algorithms-active': '1.1.0', 'api.things-feed': '1.7.0', 'api.things-search': '1.3.0', 'api.things': '1.64.0' };
  for (const [feature, version] of Object.entries(requirements)) {
    assert.equal(capabilitySatisfies(manifest.features[feature]?.version, version), true);
    assert.equal(capabilitySatisfies('', version), false);
    assert.equal(capabilitySatisfies('2.0.0', version), false);
  }
  assert.equal(capabilitySatisfies('1.6.0', requirements['api.things-feed']), false);
});

test('Lopu network SDK contract exists on both manifests and refuses missing/breaking origins', () => {
  const manifest = thingtimeCapabilityManifest('https://thingtime.test');
  assert.equal(manifest.features['api.lopu-network'].version, '1.0.0');
  assert.equal(createApiCapabilitiesManifest().features['api.lopu-network'], '1.0.0');
  assert.ok(manifest.operations.some(operation => operation.path === '/api/v1/lopu/network' && operation.methods.includes('POST')));
  assert.equal(capabilitySatisfies('1.0.1', '1.0.0'), true);
  assert.equal(capabilitySatisfies('', '1.0.0'), false);
  assert.equal(capabilitySatisfies('2.0.0', '1.0.0'), false);
});

test('upload burst correction is published by both manifests and rejects old or breaking origins', () => {
	assert.equal(createApiCapabilitiesManifest().features['api.attachment-uploads'], '1.11.0');
	assert.equal(thingtimeCapabilityManifest('https://uploads.test').features['api.attachment-uploads'].version, '1.11.0');
	for (const version of [undefined, '1.4.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.4.1'), false);
	for (const version of ['1.4.1', '1.4.2', '1.5.0']) assert.equal(capabilitySatisfies(version, '1.4.1'), true);
});

test('file finalization recovery requires the compatible upload-start correction', () => {
	for (const version of [undefined, '1.6.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.6.1'), false);
	for (const version of ['1.6.1', '1.6.2', '1.7.0']) assert.equal(capabilitySatisfies(version, '1.6.1'), true);
});

test('crawler discovery endpoints publish their root paths and -docs twins on the origin manifest', () => {
  const manifest = thingtimeCapabilityManifest('https://thingtime.test');
  for (const feature of ['api.sitemap', 'api.seo-robots', 'api.seo-sitemap']) assert.equal(manifest.features[feature]?.version, '1.0.0', feature);
  const paths = (feature: string) => manifest.operations.filter((operation) => operation.feature === feature).map((operation) => operation.path).sort();
  assert.deepEqual(paths('api.seo-robots'), ['/robots.txt', '/robots.txt-docs']);
  assert.deepEqual(paths('api.seo-sitemap'), ['/sitemap.xml', '/sitemap.xml-docs']);
  assert.deepEqual(paths('api.sitemap'), ['/api/v1/sitemap', '/api/v1/sitemap-docs']);
});

test('inherited audience clients negotiate the additive read and ancestor moderation contracts', () => {
  const manifest = thingtimeCapabilityManifest('https://thingtime.test');
  for (const [id, minimum, previous] of [['api.things', '1.64.0', '1.20.0'], ['api.attachment-content', '1.20.0', '1.8.0']]) {


    assert.equal(capabilitySatisfies(manifest.features[id].version, minimum), true);
    for (const actual of [undefined, previous, '2.0.0']) assert.equal(capabilitySatisfies(actual, minimum), false);
  }
});

test('Thing discussions and linked post references negotiate additive contracts on both manifests', () => {
  const source = createApiCapabilitiesManifest();
  const manifest = thingtimeCapabilityManifest('https://things.test');
  for (const [feature, required, old] of [['api.things', '1.64.0', '1.27.0'], ['api.things-comment', '1.12.0', '1.7.0'], ['api.things-feed', '1.10.0', '1.7.0'], ['api.things-user', '1.9.0', '1.6.0']]) {


    assert.equal(source.features[feature], required);
    assert.equal(manifest.features[feature].version, feature === 'api.attachment-uploads' ? '1.11.0' : required);
    for (const incompatible of [undefined, old, '2.0.0']) assert.equal(capabilitySatisfies(incompatible, required), false);
    for (const compatible of [required, '1.99.0']) assert.equal(capabilitySatisfies(compatible, required), true);
  }
});

test('functional demo capabilities advertise compatible catalog and install contracts', () => {
  const manifest = thingtimeCapabilityManifest('https://thingtime.com');
  for (const [feature, publishedVersion, minimum] of [
    ['api.webpages-demos', '1.1.0', '1.1.0'],
    ['api.webpages-suites-install', '1.7.0', '1.1.0'],
    ['api.admin-webpages-seed-demos', '1.2.0', '1.1.0']
  ]) {
    assert.equal(manifest.features[feature]?.version, publishedVersion);
    assert.ok(capabilitySatisfies(manifest.features[feature].version, minimum));
    assert.equal(capabilitySatisfies('1.0.0', minimum), false);
  }
  assert.equal(capabilitySatisfies('1.0.0', '1.1.0'), false);
  assert.equal(capabilitySatisfies('2.0.0', '1.1.0'), false);
});

 test('workspace provider diagnostics are explicitly versioned', () => {
  const features = thingtimeCapabilityManifest('https://workspace.test').features;
  assert.equal(features['api.builder-workspaces'].version, '1.1.0');
 });


test('native animation programs require compatible playback lifecycle support', () => {
  for (const manifest of [createApiCapabilitiesManifest().features, Object.fromEntries(Object.entries(thingtimeCapabilityManifest('https://animation.test').features).map(([key, value]) => [key, value.version]))]) {
    assert.equal(manifest['api.actions-run'], '1.46.0');

  }
  for (const version of ['1.32.0', '1.32.1', '1.33.1']) assert.equal(capabilitySatisfies(version, '1.32.0'), true);
  for (const version of ['', '1.31.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.32.0'), false);
});

test('XPath programs require owned synchronous query support', () => {
  const current = createApiCapabilitiesManifest().features['api.actions-run'];
  assert.equal(current, '1.46.0');

  assert.equal(capabilitySatisfies(current, '1.34.0'), true);
  for (const version of ['', '1.33.1', '1.33.1', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.34.0'), false);
});

test('native traversal requires bounded synchronous callback support on both manifests', () => {
  for (const current of [
    createApiCapabilitiesManifest().features['api.actions-run'],
    thingtimeCapabilityManifest('https://traversal.test').features['api.actions-run'].version
  ]) {
    assert.equal(current, '1.46.0');

    assert.equal(capabilitySatisfies(current, '1.35.1'), true);
    for (const old of ['', '1.34.0', '1.34.1', '2.0.0']) assert.equal(capabilitySatisfies(old, '1.35.1'), false);
  }
});


test('server Action outcomes are discoverable in both capability manifests', () => {
  for (const features of [createApiCapabilitiesManifest().features, Object.fromEntries(Object.entries(thingtimeCapabilityManifest('https://outcomes.test').features).map(([id, feature]) => [id, feature.version]))]) {
    assert.equal(features['api.actions-run'], '1.46.0');

    assert.equal(features['api.timeline'], '1.23.0');
    assert.equal(capabilitySatisfies('1.36.0', '1.38.0'), false);
    assert.equal(capabilitySatisfies('1.15.0', '1.16.0'), false);
    assert.equal(capabilitySatisfies('1.16.0', '1.17.0'), false);
    assert.equal(capabilitySatisfies('1.17.0', '1.18.0'), false);
    assert.equal(capabilitySatisfies('1.20.0', '1.21.0'), false);
  }
});


test('conditional interaction sync advertises a distinct compatible capability', () => {
 for (const features of [createApiCapabilitiesManifest().features, Object.fromEntries(Object.entries(thingtimeCapabilityManifest('https://interactions.test').features).map(([id, feature]) => [id, feature.version]))]) {
  assert.equal(features['api.things-interactions'], '1.0.0');
  assert.equal(capabilitySatisfies(features['api.things-interactions'], '1.0.0'), true);
 }
 for (const version of ['', '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), false);
 assert.equal(capabilitySatisfies('1.1.0', '1.0.0'), true);
});


test('existing owned file receipt deletion is advertised by both capability manifests', () => {
  assert.equal(createApiCapabilitiesManifest().features['api.attachment-delete'], '1.9.0');
  assert.equal(thingtimeCapabilityManifest('https://files.test').features['api.attachment-delete'].version, '1.9.0');
  for (const version of ['', '1.0.0', '1.1.0', '1.3.0', '1.4.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.5.0'), false);
});


test('durable upload cancellation requires the additive 1.3.0 contract on both manifests', () => {
  assert.equal(createApiCapabilitiesManifest().features['api.attachment-upload-abort'], '1.4.0');
  assert.equal(thingtimeCapabilityManifest('https://files.test').features['api.attachment-upload-abort'].version, '1.4.0');
  for (const version of ['', '1.0.0', '1.2.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.3.0'), false);
});


test('owned file and recording retention requires the additive content 1.14.0 contract', () => {
  assert.equal(createApiCapabilitiesManifest().features['api.attachment-content'], '1.20.0');
  assert.equal(thingtimeCapabilityManifest('https://files.test').features['api.attachment-content'].version, '1.20.0');
  for (const version of ['1.12.0', '1.13.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.14.0'), false);
});

test('owned-original streams require additive content 1.16.0 in both origin manifests', () => {
 assert.equal(createApiCapabilitiesManifest().features['api.attachment-content'], '1.20.0');
 assert.equal(thingtimeCapabilityManifest('https://files.test').features['api.attachment-content'].version, '1.20.0');
 for (const version of ['', '1.14.0', '1.15.9', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.16.0'), false);
 for (const version of ['1.16.0', '1.16.1', '1.17.0']) assert.equal(capabilitySatisfies(version, '1.16.0'), true);
});

test('Characters negotiate management and acting identities on both manifests', () => {
  const origin = 'https://characters.example.test';
  const manifest = thingtimeCapabilityManifest(origin);
  assert.equal(manifest.origin, origin);
  assert.equal(manifest.features['api.auth-characters'].version, '1.2.0');
  assert.equal(createApiCapabilitiesManifest().features['api.auth-characters'], '1.2.0');
  assert(apiV1RouteKeys.includes('v1/auth/characters'));
  for (const version of ['1.0.0', '1.0.1', '1.1.0']) assert(capabilitySatisfies(version, '1.0.0'));
  for (const version of ['', '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), false);
});

test('full Mac capability lists negotiate additive device contracts', () => {
  const manifest = thingtimeCapabilityManifest('https://preview.example.test');
  for (const [feature, current, minimum] of [
    ['api.devices', '1.16.0', '1.10.0'],
    ['api.devices-node-state', '1.15.1', '1.15.0'],
    ['api.devices-pairing-claim', '1.2.0', '1.0.0']
  ]) {
    assert.equal(manifest.features[feature]?.version, current);
    assert.equal(capabilitySatisfies(current, minimum), true);
    assert.equal(capabilitySatisfies(undefined, minimum), false);
    assert.equal(capabilitySatisfies('2.0.0', minimum), false);
  }
});


test('host resource telemetry negotiates both additive device contracts', () => {
  const manifest = thingtimeCapabilityManifest('https://devices.test');
  for (const feature of ['api.devices', 'api.devices-node-state']) {
    const current = feature === 'api.devices' ? '1.16.0' : '1.15.1';
    assert.equal(manifest.features[feature]?.version, current);
    assert.equal(createApiCapabilitiesManifest().features[feature], current);
    for (const version of ['1.14.0', '1.14.1', '1.15.0']) assert(capabilitySatisfies(version, '1.14.0'));
    for (const version of [undefined, '1.13.9', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.14.0'), false);
  }
});

test('sync ignore rules require the additive saved-policy contract on both manifests', () => {
  assert.equal(createApiCapabilitiesManifest().features['api.things'], '1.64.0');
  assert.equal(thingtimeCapabilityManifest('https://sync.test').features['api.things'].version, '1.64.0');


  for (const version of [undefined, '1.37.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.38.0'), false);
  for (const version of ['1.38.0', '1.39.1', '1.48.1']) assert.equal(capabilitySatisfies(version, '1.38.0'), true);
});


test('object-only empty finalization corrections remain compatible with shipped clients', () => {
    for (const [feature, version, minimum] of [
        ['api.attachment-uploads', '1.11.0', '1.6.1'],
        ['api.attachment-upload-complete', '1.8.0', '1.5.0']
    ]) {
        assert.equal(createApiCapabilitiesManifest().features[feature], version);
        assert.equal(thingtimeCapabilityManifest('https://uploads.test').features[feature].version, version);
        assert.equal(capabilitySatisfies(version, minimum), true);
        assert.equal(capabilitySatisfies('2.0.0', minimum), false);
    }
});


test('sync upload provenance clients require compatible contracts on the selected origin', () => {
 const manifest = thingtimeCapabilityManifest('https://provenance.test');
 for (const [feature, required, old] of [['api.attachment-uploads', '1.7.0', '1.6.2'], ['api.things', '1.64.0', '1.39.1'], ['api.files', '1.13.1', '1.9.0'], ['api.file-sync-batches', '1.4.0', '1.2.1']]) {


  assert.equal(manifest.features[feature].version, feature === 'api.attachment-uploads' ? '1.11.0' : required);
  assert.equal(capabilitySatisfies(old, required), false);
  assert.equal(capabilitySatisfies('2.0.0', required), false);
 }
});

test('retry-safe linked galleries require additive link and delete contracts on both manifests', () => {
  const registry = createApiCapabilitiesManifest(), manifest = thingtimeCapabilityManifest('https://links.test');
  for (const [feature, version] of [['api.attachment-link', '1.3.0'], ['api.attachment-delete', '1.9.0']]) {
    assert.equal(registry.features[feature], version);
    assert.equal(manifest.features[feature].version, version);
    assert.equal(capabilitySatisfies(version, version), true);
    for (const unavailable of [undefined, '1.0.0', '2.0.0']) assert.equal(capabilitySatisfies(unavailable, version), false);
  }
  assert.equal(capabilitySatisfies('1.7.9', '1.8.0'), false);
  assert.equal(capabilitySatisfies('1.2.0', '1.3.0'), false);
  assert.equal(capabilitySatisfies('1.9.0', '1.8.0'), true);
});


test('editable media containers require compatible element storage contracts on both manifests', () => {
 const generated=createApiCapabilitiesManifest();
 const runtime=thingtimeCapabilityManifest('https://media.test');
 for(const [feature,minimum] of [['api.things','1.64.0'],['api.things-update','1.27.0'],['api.webpages-resolve','1.19.0'],['api.webpages-suites-install','1.7.0']]) {


  assert.equal(generated.features[feature],minimum);
  assert.equal(runtime.features[feature].version,minimum);
  assert.equal(capabilitySatisfies(minimum,minimum),true);
  assert.equal(capabilitySatisfies(undefined,minimum),false);
  assert.equal(capabilitySatisfies('2.0.0',minimum),false);
 }
 assert.equal(capabilitySatisfies('1.5.9','1.6.0'),false);
});


test('combined local-first and media contracts do not accept either uncombined branch', () => {
 for(const [feature,minimum,older] of [
  ['api.things','1.64.0',['1.42.0','1.56.0']]
 ] as const) {
  assert.equal(createApiCapabilitiesManifest().features[feature],minimum);
  assert.equal(thingtimeCapabilityManifest('https://combined.test').features[feature].version,minimum);
  for(const version of older)assert.equal(capabilitySatisfies(version,minimum),false);
  assert.equal(capabilitySatisfies(minimum,minimum),true);
 }
});


test('receipt-pinned original byte streams require additive content 1.20.0 on both origin manifests', () => {
 assert.equal(createApiCapabilitiesManifest().features['api.attachment-content'], '1.20.0');
 assert.equal(thingtimeCapabilityManifest('https://files.test').features['api.attachment-content'].version, '1.20.0');
 for (const version of ['', '1.16.0', '1.18.0', '1.19.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.20.0'), false);
 for (const version of ['1.20.0', '1.20.1', '1.21.0']) assert.equal(capabilitySatisfies(version, '1.20.0'), true);
});


test('theme focus settings are additive and consistent across both manifests', async () => {
  const { THEME_CAPABILITY_REQUIREMENTS } = await import('../../../theme/capabilities');
  const requirements = { ...THEME_CAPABILITY_REQUIREMENTS, 'api.themes-shared': '1.1.0', 'api.timeline': '1.23.0' };
  const docs = createApiCapabilitiesManifest().features;
  const discovery = thingtimeCapabilityManifest('https://themes.test');
  assert.equal(discovery.origin, 'https://themes.test');
  for (const [feature, minimum] of Object.entries(requirements)) {
    assert.equal(capabilitySatisfies(docs[feature], minimum), true);
    assert.equal(discovery.features[feature].version, docs[feature]);
    assert.equal(capabilitySatisfies(minimum, minimum), true);
    assert.equal(capabilitySatisfies('1.23.0', minimum), true);
    for (const incompatible of ['', '1.0.0', '2.0.0']) assert.equal(capabilitySatisfies(incompatible, minimum), false);
  }
  assert.equal(capabilitySatisfies('1.1.9', THEME_CAPABILITY_REQUIREMENTS['api.themes']), false);
});


test('Builder provenance is negotiated independently of rendering and preserves content schemas', () => {
  const legacy = createApiCapabilitiesManifest();
  const manifest = thingtimeCapabilityManifest('https://builder.example.test');
  assert.equal(manifest.origin, 'https://builder.example.test');
  for (const [feature, minimum, previous] of [['api.things', '1.64.0', '1.46.0'], ['api.things-update', '1.27.0', '1.14.0']]) {


    assert.equal(legacy.features[feature], minimum);
    assert.equal(manifest.features[feature].version, minimum);
    assert.equal(capabilitySatisfies(previous, minimum), false);
    assert.equal(capabilitySatisfies(undefined, minimum), false);
    assert.equal(capabilitySatisfies('2.0.0', minimum), false);
    assert.equal(capabilitySatisfies(minimum, minimum), true);
  }
});


test('preview retention stored-policy failures publish a compatible correction in both manifests', () => {
  const origin = 'https://retention.test';
  const manifest = thingtimeCapabilityManifest(origin);
  assert.equal(manifest.origin, origin);
  assert.equal(manifest.features['api.admin-ci-preview-retention'].version, '1.0.1');
  assert.equal(createApiCapabilitiesManifest().features['api.admin-ci-preview-retention'], '1.0.1');
  assert.equal(manifest.features['api.integration-ci-preview-retention'].version, '1.0.0');
  assert.equal(capabilitySatisfies('1.0.1', '1.0.0'), true);
  assert.equal(capabilitySatisfies('2.0.0', '1.0.0'), false);
});

test('both manifests publish credential import and each transport and approval operation', () => {
  const origin = 'https://credentials.test';
  const source = createApiCapabilitiesManifest(apiV1RouteKeys);
  const runtime = thingtimeCapabilityManifest(origin);
  assert.equal(runtime.origin, origin);
  assert.equal(source.features['api.credentials-import'], '1.1.0');
  assert.equal(runtime.features['api.credentials-import'].version, '1.1.0');
  for (const action of ['start', 'status', 'upload', 'inspect', 'approve', 'revoke', 'direct']) {
    const path = `/api/v1/credentials/import/${action}`;
    assert.equal(source.features[`route.v1.credentials.import.${action}`], '1.0.0');
    assert.equal(runtime.features[`api.credentials-import-${action}`].version, '1.1.0');
    assert.ok(runtime.operations.some(operation => operation.path === path && operation.methods.includes('POST')));
  }
  for (const version of ['1.0.0', '1.0.1', '1.1.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), true);
  for (const version of [undefined, '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), false);
  for (const version of ['1.1.0', '1.1.1']) assert.equal(capabilitySatisfies(version, '1.1.0'), true);
  for (const version of [undefined, '1.0.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.1.0'), false);
});

test('exact geocoding and batch suggestions publish the additive Maps contract', () => {
  const required = '1.1.0';
  assert.equal(createApiCapabilitiesManifest().features['api.maps'], '1.2.0');
  assert.equal(thingtimeCapabilityManifest('https://maps.test').features['api.maps'].version, '1.2.0');
  for (const version of ['1.1.0', '1.1.1', '1.2.0']) assert.equal(capabilitySatisfies(version, required), true);
  for (const version of [undefined, '1.0.0', '2.0.0']) assert.equal(capabilitySatisfies(version, required), false);
});


test('empty post and message files require the compatible original-byte contracts', () => {
 for (const [feature, minimum, previous] of [['api.attachment-uploads', '1.11.0', '1.7.0'], ['api.attachment-upload-complete', '1.8.0', '1.5.1']]) {
  assert.equal(createApiCapabilitiesManifest().features[feature], minimum);
  assert.equal(thingtimeCapabilityManifest('https://shares.test').features[feature].version, minimum);
  for (const version of [undefined, previous, '2.0.0']) assert.equal(capabilitySatisfies(version, minimum), false);
  assert.equal(capabilitySatisfies(minimum, minimum), true);
 }
});


test('long Data text requires compatible write import and schema contracts', () => {
 for (const [feature, minimum, previous] of [['api.things', '1.64.0', '1.49.2'], ['api.things-update', '1.27.0', '1.18.1'], ['api.things-import', '1.15.0', '1.12.0'], ['api.schemas', '1.2.0', '1.1.1'], ['api.things-bulk', '1.9.0', '1.6.0'], ['api.actions-run', '1.46.0', '1.40.1'], ['api.chatgpt-mcp', '2.3.0', '2.1.0'], ['api.builder-workspaces', '1.1.0', '1.0.1']]) {
  assert.equal(createApiCapabilitiesManifest().features[feature], minimum);
  assert.equal(thingtimeCapabilityManifest('https://shares.test').features[feature].version, minimum);
  for (const version of [undefined, previous, `${Number(minimum.split('.')[0]) + 1}.0.0`]) assert.equal(capabilitySatisfies(version, minimum), false);
  assert.equal(capabilitySatisfies(minimum, minimum), true);
 }
});


test('shared content input and projection contracts agree on both origin manifests', () => {
 const generated = createApiCapabilitiesManifest();
 const runtime = thingtimeCapabilityManifest('https://shares.test');
 for (const [feature, minimum] of [['api.attachment-uploads', '1.11.0'], ['api.attachment-upload-complete', '1.8.0'], ['api.attachment-annotate', '1.4.0'], ['api.attachment-link', '1.3.0'], ['api.attachment-content', '1.20.0'], ['api.files', '1.13.1'], ['api.things-share', '1.5.0'], ['api.things-feed', '1.10.0'], ['api.things-user', '1.9.0'], ['api.things-search', '1.8.0'], ['api.things-export', '1.18.0'], ['api.things-comment', '1.12.0']]) {
  assert.equal(generated.features[feature], minimum);
  assert.equal(runtime.features[feature].version, minimum);
  assert.equal(capabilitySatisfies(minimum, minimum), true);
  assert.equal(capabilitySatisfies(undefined, minimum), false);
  assert.equal(capabilitySatisfies('2.0.0', minimum), false);
 }
});


test('authenticated shared-content body contracts publish deliberate minors in both manifests', () => {
 const expected = {'api.things':'1.64.0','api.things-update':'1.27.0','api.things-comment':'1.12.0','api.chats-messages':'1.6.0','api.chats-messages-edit':'1.3.0','api.attachment-uploads':'1.11.0','api.attachment-annotate':'1.4.0','api.attachment-link':'1.3.0','api.files':'1.13.1'};
 const source=createApiCapabilitiesManifest(), runtime=thingtimeCapabilityManifest('https://shared-content.test');
 for (const [feature,version] of Object.entries(expected)) {
  assert.equal(source.features[feature],version); assert.equal(runtime.features[feature].version,version);
  assert.equal(apiEndpointDocs.find(doc => `api.${doc.id}`===feature)?.contractVersion,version);
  assert.ok(capabilitySatisfies(version, SHARED_CONTENT_REQUIREMENTS[feature as keyof typeof SHARED_CONTENT_REQUIREMENTS]));
  const [major,minor,patch]=version.split('.').map(Number);
  assert.equal(capabilitySatisfies(`${major}.${minor-1}.99`,version),false);
  assert.equal(capabilitySatisfies(`${major}.${minor}.${patch+1}`,version),true);
  assert.equal(capabilitySatisfies(`${major+1}.0.0`,version),false);
 }
});

test('local native range scope publishes its additive contract on both manifests', () => {
  const feature = 'api.attachment-local-object';
  assert.equal(createApiCapabilitiesManifest().features[feature], '1.1.0');
  const runtime = thingtimeCapabilityManifest('https://local-storage.test');
  assert.equal(runtime.features[feature].version, '1.1.0');
  assert.ok(runtime.operations.some(operation => operation.feature === feature && operation.path === '/api/v1/attachments/local-object' && operation.methods.includes('GET')));
  for (const version of ['1.1.0', '1.1.1', '1.2.0']) assert.equal(capabilitySatisfies(version, '1.1.0'), true);
  for (const version of [undefined, '1.0.1', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.1.0'), false);

});


test('combined shared Action values reject authored-control-only origins', () => {
 const required=SHARED_CONTENT_REQUIREMENTS['api.actions-run'];
 assert.equal(required,'1.43.0');
 assert.equal(capabilitySatisfies(createApiCapabilitiesManifest().features['api.actions-run'],required),true);
 assert.equal(capabilitySatisfies(thingtimeCapabilityManifest('https://combined-action.test').features['api.actions-run'].version,required),true);
 for(const version of [undefined,'1.41.0','1.42.1','2.0.0']) assert.equal(capabilitySatisfies(version,required),false);
 for(const version of ['1.43.0','1.43.1','1.44.0','1.46.0']) assert.equal(capabilitySatisfies(version,required),true);
});


test('full content Timeline clients require the corrected broad snapshot reader', () => {
 const required=SHARED_CONTENT_REQUIREMENTS['api.timeline'];
 assert.equal(required,'1.19.2');
 assert.equal(createApiCapabilitiesManifest().features['api.timeline'],'1.23.0');
 assert.equal(thingtimeCapabilityManifest('https://broad-snapshot.test').features['api.timeline'].version,'1.23.0');
 for(const version of [undefined,'1.19.1','2.0.0']) assert.equal(capabilitySatisfies(version,required),false);
 for(const version of ['1.19.2','1.19.3','1.20.0']) assert.equal(capabilitySatisfies(version,required),true);
});

test('device folder operations share origin-scoped discovery and explicit client requirements', () => {
 const manifest = thingtimeCapabilityManifest('https://folders.example.test');
 assert.equal(manifest.features['api.devices-folders'].version, '1.0.0');
 assert.equal(createApiCapabilitiesManifest().features['api.devices-folders'], '1.0.0');
 assert.deepEqual(manifest.operations.find(operation => operation.path === '/api/v1/devices/folders')?.methods, ['GET', 'POST']);
 assert(capabilitySatisfies('1.1.0', '1.0.0'));
 assert.equal(capabilitySatisfies(undefined, '1.0.0'), false);
 assert.equal(capabilitySatisfies('2.0.0', '1.0.0'), false);
});


test('Photos automation settings and exact publication are additive origin-scoped capabilities', async () => {
 const { FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS } = await import('../../../fileSync/configuration');
 const origin = 'https://photos.test';
 const source = createApiCapabilitiesManifest(), runtime = thingtimeCapabilityManifest(origin);
 for (const [feature, minimum, previous] of [...Object.entries(FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS).map(([feature, version]) => [feature, version, feature === 'api.things' ? '1.52.1' : '1.20.0']), ['api.file-sync-transfer-admissions', '1.3.1', '1.2.0']]) {
  assert.equal(source.features[feature], runtime.features[feature]?.version);
  assert.equal(capabilitySatisfies(source.features[feature], minimum), true);
  assert.equal(capabilitySatisfies(minimum, minimum), true);
  assert.equal(capabilitySatisfies(previous, minimum), false);
  assert.equal(capabilitySatisfies('2.0.0', minimum), false);
 }
});

test('native background file transport is an explicit compatible transfer admission capability', () => {
 const minimum = '1.5.0';
 const docs = createApiCapabilitiesManifest(), runtime = thingtimeCapabilityManifest('https://photos.test');
 assert.equal(docs.features['api.file-sync-transfer-admissions'], '1.5.1');
 assert.equal(runtime.features['api.file-sync-transfer-admissions']?.version, '1.5.1');
 assert(capabilitySatisfies('1.5.1', minimum));
 for (const version of [undefined, '1.4.0', '2.0.0']) assert.equal(capabilitySatisfies(version, minimum), false);
 assert.deepEqual(runtime.operations.find(operation => operation.path === '/api/v1/files/sync-transfer-admissions')?.methods, ['POST']);
});

test('session replacement reports compatible protection for scoped file-sync reservations', () => {
  const versions = {
    'api.auth-accounts-assume': ['1.1.0', '1.1.1'],
    'api.auth-accounts-remove': ['1.1.0', '1.1.1'],
    'api.auth-accounts-switch': ['1.1.0', '1.1.1'],
    'api.auth-logout': ['1.2.0', '1.2.1'],
    'api.auth-passkeys-login': ['1.3.0', '1.3.1'],
    'api.auth-register': ['1.3.1', '1.4.0'],
    'api.login': ['1.3.0', '1.3.1']
  };
  const manifest = thingtimeCapabilityManifest('https://sessions.test');
  const docs = createApiCapabilitiesManifest();
  for (const [feature, [previous, current]] of Object.entries(versions)) {
    assert.equal(manifest.features[feature]?.version, current);
    assert.equal(docs.features[feature], current);
    assert.equal(capabilitySatisfies(current, previous), true);
  }
});

test('expanded Webpage authoring negotiates compatible writes and preview on the selected origin', () => {
 const source = createApiCapabilitiesManifest();
 const origin = 'https://builder.example';
 const runtime = thingtimeCapabilityManifest(origin);
 assert.equal(runtime.origin, origin);
 for (const [feature, minimum] of Object.entries(EXPANDED_WEBPAGE_AUTHORING_REQUIREMENTS)) {
  assert.equal(capabilitySatisfies(source.features[feature], minimum), true);
  assert.equal(capabilitySatisfies(runtime.features[feature].version, minimum), true);
  const [major, minor] = minimum.split('.').map(Number);
  assert.equal(capabilitySatisfies(`${major}.${minor - 1}.99`, minimum), false);
  assert.equal(capabilitySatisfies(undefined, minimum), false);
  assert.equal(capabilitySatisfies('2.0.0', minimum), false);
  assert.equal(capabilitySatisfies(`${major}.${minor}.1`, minimum), true);
 }
});


test('auth sessions and public profiles advertise optional saved image presentation', () => {
  const source = createApiCapabilitiesManifest();
  const runtime = thingtimeCapabilityManifest('https://profile.test');
  for (const [feature, version] of Object.entries({
    'api.auth-me': '1.2.0',
    'api.login': '1.3.1',
    'api.auth-passkeys-login': '1.3.1',
    'api.auth-sso-session': '1.2.0',
    'api.auth-characters': '1.2.0',
    'api.auth-temporary': '1.1.0',
    'api.auth-logout': '1.2.1',
    'api.auth-accounts-remove': '1.1.1',
    'api.users-profile': '1.2.0',
    'api.auth-accounts': '1.1.0',
    'api.auth-accounts-owned': '1.1.0',
  })) {
    assert.equal(source.features[feature], version);
    assert.equal(runtime.features[feature]?.version, version);
  }
});



test('Archive extended reads reject either incomplete 1.63 contract', () => {
  assert.deepEqual(LIBRARY_ARCHIVE_READ_REQUIREMENTS, { 'api.things': '1.64.0' });
  const current = createApiCapabilitiesManifest().features['api.things'];
  const runtime = thingtimeCapabilityManifest('https://archive.test').features['api.things'].version;
  for (const version of [current, runtime]) assert.equal(capabilitySatisfies(version, LIBRARY_ARCHIVE_READ_REQUIREMENTS['api.things']), true);
  for (const version of [undefined, '1.62.0', '1.62.99', '1.63.0', '1.63.99', '2.0.0']) assert.equal(capabilitySatisfies(version, LIBRARY_ARCHIVE_READ_REQUIREMENTS['api.things']), false);
});
