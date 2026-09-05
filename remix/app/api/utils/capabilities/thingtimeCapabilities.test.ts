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
  for (const feature of ['api.things', 'api.things-comment', 'api.things-feed', 'api.things-user']) {
    assert.equal(manifest.features[feature]?.version, '1.3.0', feature);
  }
  for (const feature of ['api.subspaces-modlog', 'api.things-updown']) {
    assert.equal(manifest.features[feature]?.version, '1.0.0', feature);
  }
  // S3 review: moderate's re-projected post carries authorFlair (1.1.0, additive)
  assert.equal(manifest.features['api.subspaces-moderate']?.version, '1.1.0');
  // round 2 S2 — join requests + posting-approval requests: private join
  // files a request (join 1.1.0), leave cancels it (1.1.0), the list rows /
  // detail carry viewer.pending + approvalRequested and mods get the queue
  // sizes (subspaces + get 1.1.0), and members grew the two queues + accept /
  // deny / request-approval (1.1.0 → 1.2.0; 1.1.0 was the role/ban notify)
  // S3 review: join / leave answer the subspace block with the user-flair
  // settings + viewer.userFlair (1.2.0, additive)
  assert.equal(manifest.features['api.subspaces-leave']?.version, '1.2.0');
  // round 2 S3 — user flairs: the subspace projection carries userFlairs /
  // userFlairSelfAssign / allowCustomUserFlair + viewer.userFlair (list + get
  // 1.2.0), update takes the three settings (1.2.0), members rows carry
  // userFlair + the userFlair action (1.3.0), the subspace feed's posts wear
  // authorFlair (1.1.0) — all additive
  for (const feature of ['api.subspaces', 'api.subspaces-get', 'api.subspaces-update']) {
    assert.equal(manifest.features[feature]?.version, '1.2.0', feature);
  }
  // S3 review: kick / ban strip the flair, demotion strips a mod-only pick,
  // mods may dress the owner (members 1.3.1, corrections)
  assert.equal(manifest.features['api.subspaces-members']?.version, '1.3.1');
  assert.equal(manifest.features['api.subspaces-feed']?.version, '1.1.0');
  // S2 review: a re-request starts from a clean row + the mods' bell is
  // deduped + join has its own rate key (join 1.1.1, corrections); decisions
  // on a withdrawn request answer 409, unrelated actions on a pending row
  // 400/404, remove revokes approval (members 1.2.1, corrections); an access
  // change resolves the request queues and tells the requesters (update
  // 1.1.0, additive side effect)
  assert.equal(manifest.features['api.subspaces-join']?.version, '1.2.0');
  // S1 review: transfer's writes are guarded (a racing transfer answers 409 —
  // compatible correction); delete answers { privatePosts } beside
  // releasedPosts, holds the slug for its previous owner and refuses (409)
  // rather than strand posts behind a missing doc (additive)
  // S3 review: transfer's newOwner row carries userFlair (1.1.0, additive)
  assert.equal(manifest.features['api.subspaces-transfer']?.version, '1.1.0');
  assert.equal(manifest.features['api.subspaces-delete']?.version, '1.1.0');
  assert.equal(manifest.features['api.notifications-list']?.version, '1.1.0');
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
