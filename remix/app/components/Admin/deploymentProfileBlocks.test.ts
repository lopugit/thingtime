import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { DEPLOYMENT_PROFILE_BLOCKS, PROFILE_FIELDS } from './deploymentProfileBlocks';
import type { WebpageBlock } from '../Builder/webpageBlocks';

test('profile settings are a valid saved layout with independently editable form controls', () => {
  function flatten(blocks: WebpageBlock[]): WebpageBlock[] {
    return blocks.flatMap(block => [block, ...flatten(block.children || [])]);
  }
  const fields = flatten(settingsDocumentBlocks(DEPLOYMENT_PROFILE_BLOCKS));
  assert.equal(new Set(fields.map(field => field.id)).size, fields.length);
  for (const name of Object.keys(PROFILE_FIELDS)) {
    assert.ok(fields.some(block => block.tag === 'input' && block.props?.name === name), name);
  }
  for (const lane of ['production', 'development', 'preview']) {
    const checkbox = fields.find(block => block.id === 'deployment-profile-' + lane + '-input');
    assert.equal(checkbox?.props?.type, 'checkbox');
    assert.deepEqual(checkbox?.props?.['data-tt-action-inputs'], { operation: 'profile.lane', lane });
  }
  const input = fields.find(block => block.id === 'deployment-profile-team-id-input');
  assert.equal(input?.props?.['data-tt-action'], '$transient');
});
