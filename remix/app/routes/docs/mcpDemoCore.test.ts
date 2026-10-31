import assert from 'node:assert/strict';
import test from 'node:test';

import { thingtimeToolDefinitions } from '../../api/utils/chatgpt/plugin';
import {
  MCP_DEMO_FALLBACK_SNAPSHOT,
  mcpDemoScenarios,
  parseMcpDemoSnapshot,
  reviewPayloadForScenario
} from './mcpDemoCore';

test('demo scenarios reference only published MCP tools', () => {
  const published = new Set<string>(thingtimeToolDefinitions.map((tool) => tool.name));
  const referenced = mcpDemoScenarios.flatMap((scenario) => scenario.steps.map((step) => step.tool));

  assert.equal(mcpDemoScenarios.length, 5);
  assert.deepEqual(referenced.filter((tool) => !published.has(tool)), []);
  assert.ok(mcpDemoScenarios.every((scenario) => scenario.steps.length >= 4));
});

test('live snapshot parser accepts complete discovery and rejects partial data', () => {
  assert.deepEqual(
    parseMcpDemoSnapshot({
      initialize: { serverInfo: { version: '1.3.0' } },
      tools: { tools: Array.from({ length: 31 }) },
      prompts: { prompts: Array.from({ length: 5 }) },
      resources: { resources: Array.from({ length: 2 }) },
      resourceTemplates: { resourceTemplates: Array.from({ length: 4 }) },
      manifest: { features: Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`feature-${index}`, {}])), operations: Array.from({ length: 36 }) }
    }),
    MCP_DEMO_FALLBACK_SNAPSHOT
  );
  assert.equal(parseMcpDemoSnapshot({ initialize: { serverInfo: { version: '1.3.0' } } }), null);
});

test('review payload is demo-only and gates only workflows that compose writes', () => {
  for (const scenario of mcpDemoScenarios) {
    const payload = reviewPayloadForScenario(scenario);
    const composesWrites = scenario.steps.some((step) => step.boundary !== 'read');
    assert.equal(payload.account.id, 'demo-account');
    assert.equal(payload.confirmationRequired, composesWrites);
    if (composesWrites) {
      assert.match(payload.receipt || '', /^demo-signed-receipt:/);
    } else {
      assert.equal(payload.receipt, undefined);
    }
    assert.equal(payload.preview.operations.length, scenario.steps.length);
    assert.ok(payload.preview.operations.every((operation) => operation.before.demo && operation.after.demo));
  }
});
