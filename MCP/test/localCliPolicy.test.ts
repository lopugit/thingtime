import assert from 'node:assert/strict';
import test from 'node:test';
import { isolatedRenderConfiguration, ISOLATED_RENDER_CLEANUP_MAX_MS, ISOLATED_RENDER_DEADLINE_MS } from '../src/isolatedRender.js';
import { LOCAL_RENDER_TOOL, localAdapterEnvironment, localToolFailure, localToolTimeout } from '../src/localCliPolicy.js';

test('the local helper configures the canonical isolated renderer without forwarding account or proxy secrets', () => {
  const env = localAdapterEnvironment({
    THINGTIME_MCP_RENDER_IMAGE: `sha256:${'a'.repeat(64)}`,
    THINGTIME_MCP_RENDER_SOCKET: '/tmp/task-render.sock',
    THINGTIME_MCP_RENDER_DOCKER: '/opt/homebrew/bin/docker',
    THINGTIME_MCP_RENDER_ASSETS: '/tmp/task-render-assets',
    THINGTIME_MCP_ALLOWED_ROOTS: '/tmp/approved-import',
    THINGTIME_MCP_STATE_DIR: '/tmp/task-store',
    THINGTIME_TOKEN: 'test-account-secret', HTTP_PROXY: 'test-proxy-secret',
    NODE_OPTIONS: '--require=/tmp/untrusted', DOCKER_CONFIG: '/tmp/personal-docker'
  });
  const configured = isolatedRenderConfiguration(env);
  assert.ok(configured.launch);
  assert.ok(configured.launch.args.includes('/tmp/task-render.sock'));
  assert.ok(configured.launch.args.includes('/tmp/task-render-assets'));
  for (const key of ['THINGTIME_TOKEN', 'HTTP_PROXY', 'NODE_OPTIONS', 'DOCKER_CONFIG']) assert.equal(env[key], undefined);
  assert.equal(configured.launch.env.THINGTIME_MCP_ALLOWED_ROOTS, undefined);
  assert.equal(configured.launch.env.THINGTIME_MCP_STATE_DIR, undefined);
  assert.ok(isolatedRenderConfiguration(localAdapterEnvironment({})).error);
});

test('the local helper deadline leaves time for the isolated renderer work and verified cleanup', () => {
  assert.ok(localToolTimeout(LOCAL_RENDER_TOOL) >= 240_000);
  assert.ok(localToolTimeout(LOCAL_RENDER_TOOL) > ISOLATED_RENDER_DEADLINE_MS + ISOLATED_RENDER_CLEANUP_MAX_MS);
  assert.equal(localToolTimeout('thingtime_capabilities'), 60_000);
});

test('render failures give actionable fixed diagnostics without echoing private payloads', () => {
  for (const [message, expected] of [
    ['Isolated rendering is disabled: /private/task-secret', /Configure the isolated renderer/],
    ['Isolated renderer cleanup could not be verified /private/task-secret', /cleanup could not be verified/],
    ['Isolated render deadline exceeded /private/task-secret', /exceeded its deadline/],
    ['Renderer busy; /private/task-secret', /renderer is busy/],
    ['Isolated render cancelled /private/task-secret', /render was cancelled/],
    ['unexpected /private/task-secret', /Check the content/]
  ] as const) {
    const label = localToolFailure(LOCAL_RENDER_TOOL, { isError: true, content: [
      { type: 'text', text: JSON.stringify({ ok: false, code: 'RENDER_EXPORT_FAILED', error: message }) }
    ] });
    assert.match(label, expected);
    assert.match(label, /No artifacts were saved/);
    assert.doesNotMatch(label, /task-secret/);
  }
  assert.match(localToolFailure(LOCAL_RENDER_TOOL, { isError: true, content: [{ type: 'text', text: 'not-json task-secret' }] }), /Check the content/);
});
