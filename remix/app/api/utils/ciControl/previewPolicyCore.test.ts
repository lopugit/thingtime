import assert from 'node:assert/strict';
import test from 'node:test';

import { adminPreviewDeploymentPayload, isCiPreviewEnvironment } from './previewPolicyCore';

const common = {
  projectId: 'prj_example',
  projectName: 'thingtime',
  gitRepoId: 42,
  repositoryId: 84,
  repository: 'lopugit/thingtime',
  prNumber: 496,
  headRef: 'codex/example',
  headSha: 'a'.repeat(40),
  developEnvironmentId: 'env_develop'
};

test('admin preview environments are closed to develop and production', () => {
  assert.equal(isCiPreviewEnvironment('develop'), true);
  assert.equal(isCiPreviewEnvironment('production'), true);
  assert.equal(isCiPreviewEnvironment('preview'), false);
});

test('production-data previews never auto-assign production domains', () => {
  const payload = adminPreviewDeploymentPayload({ ...common, environment: 'production' });
  assert.equal(payload.target, 'production');
  assert.equal(payload.autoAssignCustomDomains, false);
  assert.equal(payload.meta.thingtimePreviewEnvironment, 'production');
  assert.equal('customEnvironmentSlugOrId' in payload, false);
});

test('develop previews use only the configured develop Custom Environment', () => {
  const payload = adminPreviewDeploymentPayload({ ...common, environment: 'develop' });
  assert.equal(payload.customEnvironmentSlugOrId, 'env_develop');
  assert.equal('target' in payload, false);
  assert.equal(payload.autoAssignCustomDomains, false);
});
