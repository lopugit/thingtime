import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CI_AUTOMATION_DEFINITIONS,
  defaultCiAutomationPolicy,
  isCiExecutionProvider,
  isCiWorkflowKey
} from './automationPolicy';

test('CI automation definitions are unique and default to GitHub-hosted compute', () => {
  assert.equal(new Set(CI_AUTOMATION_DEFINITIONS.map((definition) => definition.key)).size, CI_AUTOMATION_DEFINITIONS.length);
  for (const definition of CI_AUTOMATION_DEFINITIONS) {
    assert.equal(defaultCiAutomationPolicy(definition.key).executionProvider, 'github-actions');
    assert.equal(isCiWorkflowKey(definition.key), true);
  }
  assert.equal(CI_AUTOMATION_DEFINITIONS.find((definition) => definition.key === 'web-ci')?.vercelSupported, false);
  assert.equal(CI_AUTOMATION_DEFINITIONS.find((definition) => definition.key === 'electron-release')?.vercelSupported, false);
  assert.equal(CI_AUTOMATION_DEFINITIONS.find((definition) => definition.key === 'feature-stack')?.vercelSupported, false);
});

test('CI automation validators reject arbitrary provider and workflow strings', () => {
  assert.equal(isCiExecutionProvider('github-actions'), true);
  assert.equal(isCiExecutionProvider('vercel-sandbox'), true);
  assert.equal(isCiExecutionProvider('attacker-runner'), false);
  assert.equal(isCiWorkflowKey('../arbitrary.yml'), false);
});
