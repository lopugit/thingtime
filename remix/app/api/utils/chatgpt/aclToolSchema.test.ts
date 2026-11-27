import assert from 'node:assert/strict';
import test from 'node:test';
import { thingtimeToolDefinitions } from './plugin';

test('the canonical MCP create/update tool schemas preserve uncapped ACL payloads', () => {
  for (const name of ['create_thingtime_thing', 'update_thingtime_thing']) {
    const tool = thingtimeToolDefinitions.find(tool => tool.name === name)!;
    const payload = (tool.inputSchema as any).properties.thing;
    assert.equal(payload.type, 'object');
    assert.equal(payload.maxProperties, undefined);
    assert.equal(payload.properties?.acl?.maxItems, undefined);
    assert.equal(payload.properties?.acl?.items?.maxLength, undefined);
  }
});
