import assert from 'node:assert/strict';
import test from 'node:test';
import { agentTestEnvironment } from './agentTesting';

test('isolated test configuration requires a unique local replica set, generated auth and no fallback', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const environment = { THINGTIME_AGENT_TEST_MODE: '1', THINGTIME_AGENT_TEST_SESSION: id, JWT_SECRET: 'x'.repeat(64), MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:27017/thingtime?replicaSet=tt-agent-${id}` };
  assert.equal(agentTestEnvironment(environment)?.sessionId, id);
  for (const changed of [
    { JWT_SECRET: '' }, { THINGTIME_AGENT_TEST_SESSION: '' }, { JWT_PRIVATE_KEY: 'production-key' },
    { THINGTIME_API_FALLBACK_ORIGIN: 'https://thingtime.com' },
    { MONGODB_CONNECTION_STRING: 'mongodb://production.invalid/thingtime' },
    { MONGODB_CONNECTION_STRING: 'mongodb://127.0.0.1:27017/thingtime?replicaSet=other-agent' },
    { MONGODB_CONNECTION_STRING: environment.MONGODB_CONNECTION_STRING + '&proxyHost=production.invalid' }
  ]) assert.throws(() => agentTestEnvironment({ ...environment, ...changed }));
  assert.equal(agentTestEnvironment({}), null);
});
