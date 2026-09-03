import assert from 'node:assert/strict';
import test from 'node:test';

import { isCiPreviewEnvironment } from './previewPolicyCore';

test('admin preview environments are closed to develop and production', () => {
  assert.equal(isCiPreviewEnvironment('develop'), true);
  assert.equal(isCiPreviewEnvironment('production'), true);
  assert.equal(isCiPreviewEnvironment('preview'), false);
});
