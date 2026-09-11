import assert from 'node:assert/strict';
import test from 'node:test';

import { apiEndpointDocs, apiV1DocsRouteKeys, apiV1RouteKeys, createApiCapabilitiesManifest } from '../../../docs/apiDocs';
import { capabilitySatisfies } from './capabilityContract';
import { THINGTIME_CAPABILITY_MANIFEST_PATH, thingtimeCapabilityManifest } from './thingtimeCapabilities';

test('managed-folder transfer clients reject old and breaking import/export contracts', () => {
  for (const version of ['1.7.0', '1.7.1', '1.8.0']) assert.equal(capabilitySatisfies(version, '1.7.0'), true);
  for (const version of ['1.0.1', '1.5.0', '1.6.0', '1.6.1', '2.0.0', '']) assert.equal(capabilitySatisfies(version, '1.7.0'), false);
});

test('recording import upload requirements cover start and completion lifecycle versions', () => {
  const manifest = thingtimeCapabilityManifest('https://preview.example.test');
  for (const feature of ['api.attachment-uploads', 'api.attachment-upload-complete']) {
    assert.equal(manifest.features[feature]?.version, '1.3.0');
    for (const version of ['1.3.0', '1.3.1', '1.4.0']) assert.equal(capabilitySatisfies(version, '1.3.0'), true);
    for (const version of ['', '1.2.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.3.0'), false);
  }
});

test('Thingtime capability manifest is origin scoped and covers the generated API route map', () => {
  const manifest = thingtimeCapabilityManifest('https://preview.example.test/path');
  assert.equal(manifest.origin, 'https://preview.example.test');
  assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.features['api.webpages-resolve']?.version, '1.2.0');
	assert.equal(manifest.features['api.actions-run']?.version, '1.3.1');
	assert.equal(manifest.features['api.things-fork']?.version, '1.4.0');
	assert.equal(manifest.features['api.things-import']?.version, '1.7.0');
	assert.equal(manifest.features['api.things-export']?.version, '1.7.0');
  for (const [feature, required, previous] of [['api.things-export', '1.7.0', '1.6.1'], ['api.attachment-content', '1.6.4', '1.6.3']]) {
    assert.equal(manifest.features[feature]?.version, required);
    assert.equal(capabilitySatisfies(required, required), true);
    assert.equal(capabilitySatisfies(previous, required), false);
    assert.equal(capabilitySatisfies('2.0.0', required), false);
  }
  assert.equal(manifest.features['api.things-bulk']?.version, '1.2.0');
  for (const version of ['1.2.0', '1.2.1', '1.3.0']) assert.equal(capabilitySatisfies(version, '1.2.0'), true);
  for (const version of ['1.0.0', '1.1.0', '1.1.1', '2.0.0', '']) assert.equal(capabilitySatisfies(version, '1.2.0'), false);
  assert.equal(capabilitySatisfies('1.2.0', '1.3.0'), false);
  assert.equal(capabilitySatisfies('1.3.0', '1.3.0'), true);
  assert.equal(capabilitySatisfies('1.4.0', '1.3.0'), true);
  assert.equal(capabilitySatisfies('2.0.0', '1.3.0'), false);
  assert.equal(manifest.features['api.admin-migrations-run']?.version, '1.3.0');
  assert.equal(manifest.features['api.admin-subscriptions']?.version, '1.1.1');
	assert.equal(manifest.features['api.admin-ci-dispatch']?.version, '2.1.0');
  assert.equal(manifest.features['api.admin-ci-control']?.version, '1.0.2');
  assert.equal(manifest.features['api.admin-ci-credentials']?.version, '2.0.0');
  assert.equal(manifest.features['api.admin-ci-feature-stacks']?.version, '1.3.0');
  assert.equal(manifest.features['api.admin-ci-previews']?.version, '2.0.0');
  assert.equal(manifest.features['api.auth-passkeys-register-options']?.version, '1.1.0');
  assert.equal(manifest.features['api.auth-passkeys-login-options']?.version, '1.1.0');
  assert.equal(manifest.features['api.email-config']?.version, '1.0.1');
  assert.equal(manifest.features['api.health-nitro']?.version, '1.1.0');
  assert.equal(manifest.features['api.integration-ci-credentials']?.version, '1.1.0');
  assert.equal(manifest.features['api.integration-ci-progress']?.version, '1.0.0');
  assert.equal(manifest.features['api.things-search']?.version, '1.1.1');
  assert.equal(manifest.features['api.things-share']?.version, '1.1.0');
  assert.equal(manifest.features['api.users-profile']?.version, '1.1.0');
  // subspaces + up/down votes: posts/comments gained title/subspace/flair/
  // subspaceMod/votes and the feeds honour subspace fences (1.2.0, additive);
  // round 2 S3 — user flairs: posts + comments carry authorFlair, the
  // author's user flair in the post's subspace (1.3.0, additive)
  // round 2 S5 — reports: a subspace post's subspaceMod.reportCount for its
  // moderators (1.4.0, additive)
  for (const feature of ['api.things-comment', 'api.things-user']) {
    assert.equal(manifest.features[feature]?.version, '1.4.0', feature);
  }
  // round 2 S7 — comment sort: GET /api/v1/things?id= takes commentSort=
  // top|new|old (the shipped comment page in Reddit's three orders; the
  // response echoes it; unknown → 400) — the single read only, the shared
  // projection is untouched (1.5.0, additive)
  // Included dependency reads add sharedRoot without widening standalone ACLs.
  assert.equal(manifest.features['api.things']?.version, '1.10.0');
  assert.equal(manifest.features['api.lopu-reminders']?.version, '1.1.0');
  assert.equal(manifest.features['api.lopu-voice-reply']?.version, '1.3.0');
  assert.equal(manifest.features['api.lopu-recordings-run']?.version, '1.5.0');
  assert.equal(manifest.features['api.lopu-recordings-personal']?.version, '1.1.0');
  assert.equal(manifest.features['api.notifications-test']?.version, '1.2.0');
  assert.equal(manifest.features['api.attachment-content']?.version, '1.6.4');
  // round 2 S6 — discovery: the home feed takes scope=all|subspaces ("My
  // subspaces" — only the viewer's ACTIVE subspaces, empty for guests) and
  // echoes it (1.5.0, additive)
  assert.equal(manifest.features['api.things-feed']?.version, '1.5.0');
  for (const feature of ['api.subspaces-modlog', 'api.things-updown']) {
    assert.equal(manifest.features[feature]?.version, '1.0.0', feature);
  }
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
  assert.equal(manifest.features['api.subspaces-leave']?.version, '1.3.0');
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
  assert.equal(manifest.features['api.subspaces']?.version, '1.5.0');
  assert.equal(manifest.features['api.subspaces-update']?.version, '1.3.0');
  assert.equal(manifest.features['api.subspaces-get']?.version, '1.4.0');
  // S3 review: kick / ban strip the flair, demotion strips a mod-only pick,
  // mods may dress the owner (members 1.3.1, corrections)
  // S4: ban takes a private mod-log `note` (members 1.4.0, additive)
  // S4 review: the ban / unban bell comes from the mod team (1.4.1, correction)
  assert.equal(manifest.features['api.subspaces-members']?.version, '1.4.1');
  // S4: the feed's subspace block carries removalReasons (1.2.0, additive)
  // S5: moderators' posts carry subspaceMod.reportCount (1.3.0, additive)
  assert.equal(manifest.features['api.subspaces-feed']?.version, '1.3.0');
  // S2 review: a re-request starts from a clean row + the mods' bell is
  // deduped + join has its own rate key (join 1.1.1, corrections); decisions
  // on a withdrawn request answer 409, unrelated actions on a pending row
  // 400/404, remove revokes approval (members 1.2.1, corrections); an access
  // change resolves the request queues and tells the requesters (update
  // 1.1.0, additive side effect)
  assert.equal(manifest.features['api.subspaces-join']?.version, '1.3.0');
  // S1 review: transfer's writes are guarded (a racing transfer answers 409 —
  // compatible correction); delete answers { privatePosts } beside
  // releasedPosts, holds the slug for its previous owner and refuses (409)
  // rather than strand posts behind a missing doc (additive)
  // S3 review: transfer's newOwner row carries userFlair (1.1.0, additive)
  // S4: the returned subspace carries removalReasons (1.2.0, additive)
  assert.equal(manifest.features['api.subspaces-transfer']?.version, '1.2.0');
  assert.equal(manifest.features['api.subspaces-delete']?.version, '1.1.0');
  // S4 review: post-removed / ban rows carry the subspace's mod team as actor (1.2.0, additive)
  assert.equal(manifest.features['api.notifications-list']?.version, '1.7.0');
  assert.equal(manifest.features['api.notifications-settings']?.version, '1.6.0');
  assert.equal(manifest.features['api.notifications-record']?.version, '1.0.0');
  assert.equal(manifest.features['api.things-update']?.version, '1.2.6');
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

test('the Lopu catalog family publishes its verified-provider-key minor updates', () => {
  const manifest = thingtimeCapabilityManifest('https://thingtime.test');
  // 1.4.0: models[].pricing (verified-access design note §2)
  assert.equal(manifest.features['api.ai-models']?.version, '1.4.0');
  assert.equal(manifest.features['api.admin-ai-models']?.version, '1.1.0');
  assert.equal(manifest.features['api.settings-lopu-chat-defaults']?.version, '1.1.0');
  // own providers (design note §1.3): providerId on create / update / reply;
  // 1.1.1 = the write buckets fail closed, 1.2.0 = server-verified confirmations;
  // then the verified-access gate + accounting fields (create 1.2.0, reply 1.3.0),
  // and reply 1.4.0 = the in-flight cap (429 LOPU_TURN_IN_FLIGHT past three billed turns at once)
  assert.equal(manifest.features['api.lopu-chats']?.version, '1.2.0');
  assert.equal(manifest.features['api.lopu-chats-update']?.version, '1.1.1');
  assert.equal(manifest.features['api.lopu-chats-reply']?.version, '1.6.2');
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
    assert.equal(version, '1.6.2');
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
  for (const operation of ['login-options', 'login', 'register-options', 'register']) {
    const feature = `api.auth-passkeys-${operation}`;
    assert.equal(originManifest.features[feature]?.version, operation === 'login' ? '1.2.0' : '1.1.0');
    assert.equal(apiManifest.features[feature], operation === 'login' ? '1.2.0' : '1.1.0');
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
    'api.notifications-list': '1.7.0',
    'api.notifications-settings': '1.6.0'
  };
  for (const [feature, version] of Object.entries(expected)) {
    assert.equal(originManifest.features[feature]?.version, version);
    assert.equal(apiManifest.features[feature], version);
  }
});


test('native recording uploads negotiate durable private Things before sending bytes', () => {
  const manifest = thingtimeCapabilityManifest('https://thingtime.com');
  for (const feature of ['api.attachment-uploads', 'api.attachment-upload-complete']) {
    assert.equal(manifest.features[feature]?.version, '1.3.0');
    assert.equal(capabilitySatisfies(manifest.features[feature].version, '1.2.0'), true);
    assert.equal(capabilitySatisfies('1.1.0', '1.2.0'), false);
    assert.equal(capabilitySatisfies('2.0.0', '1.2.0'), false);
  }
});
