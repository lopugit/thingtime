import assert from 'node:assert/strict';
import test from 'node:test';

import { apiEndpointDocs, apiV1DocsRouteKeys, apiV1RouteKeys } from '../../../docs/apiDocs';
import { capabilitySatisfies } from './capabilityContract';
import { THINGTIME_CAPABILITY_MANIFEST_PATH, thingtimeCapabilityManifest } from './thingtimeCapabilities';

test('Thingtime capability manifest is origin scoped and covers the generated API route map', () => {
  const manifest = thingtimeCapabilityManifest('https://preview.example.test/path');
  assert.equal(manifest.origin, 'https://preview.example.test');
  assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.features['api.admin-ci-dispatch']?.version, '2.1.0');
  assert.equal(manifest.features['api.admin-ci-control']?.version, '1.0.2');
  assert.equal(manifest.features['api.admin-ci-credentials']?.version, '2.0.0');
  assert.equal(manifest.features['api.admin-ci-feature-stacks']?.version, '1.3.0');
  assert.equal(manifest.features['api.admin-ci-previews']?.version, '2.0.0');
  assert.equal(manifest.features['api.auth-passkeys-register-options']?.version, '1.0.1');
  assert.equal(manifest.features['api.auth-passkeys-login-options']?.version, '1.0.1');
  assert.equal(manifest.features['api.email-config']?.version, '1.0.1');
  assert.equal(manifest.features['api.health-nitro']?.version, '1.1.0');
  assert.equal(manifest.features['api.integration-ci-credentials']?.version, '1.1.0');
  assert.equal(manifest.features['api.integration-ci-progress']?.version, '1.0.0');
  assert.equal(manifest.features['api.things-search']?.version, '1.1.1');
  assert.equal(manifest.features['api.things-share']?.version, '1.1.0');
  // subspaces + up/down votes: posts/comments gained title/subspace/flair/
  // subspaceMod/votes and the feeds honour subspace fences (1.2.0, additive);
  // round 2 S3 — user flairs: posts + comments carry authorFlair, the
  // author's user flair in the post's subspace (1.3.0, additive)
  // round 2 S5 — reports: a subspace post's subspaceMod.reportCount for its
  // moderators (1.4.0, additive)
  for (const feature of ['api.things', 'api.things-comment', 'api.things-user']) {
    assert.equal(manifest.features[feature]?.version, '1.4.0', feature);
  }
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
  assert.equal(manifest.features['api.subspaces']?.version, '1.4.0');
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
  assert.equal(manifest.features['api.notifications-list']?.version, '1.2.0');
  assert.equal(manifest.features['api.notifications-settings']?.version, '1.1.0');
  assert.equal(manifest.features['api.things-update']?.version, '1.2.0');
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
