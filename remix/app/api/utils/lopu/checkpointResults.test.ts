import assert from 'node:assert/strict';
import test from 'node:test';
import { checkpointResultContext, checkpointToolResults } from './checkpointResults';

const pair = (id = 'run', name = 'run_action', data: unknown = { result: { days: [{ today: true, records: [] }] } }) => [
  { type: 'tool_use', id, name, input: { privateInput: 'not-retained' } },
  { type: 'tool_result', id, name, ok: true, summary: 'Ran planner read', data }
];
const done = { type: 'done', stopReason: 'checkpoint', continuationSafe: true, messages: [{ secret: 'not-retained' }] };
const wire = (events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n') + '\n';

test('checkpoint recovers completed output without retaining inputs, messages or executable calls', () => {
  const results = checkpointToolResults(wire([...pair(), done]));
  assert.deepEqual(results, [{ id: 'run', name: 'run_action', ok: true, summary: 'Ran planner read', data: { result: { days: [{ today: true, records: [] }] } } }]);
  assert.doesNotMatch(JSON.stringify(results), /not-retained|privateInput|messages/);
  assert.match(checkpointResultContext(results), /do not repeat an Action/);
  assert.equal(checkpointResultContext([]), '');
});

test('pending tools, approvals, partial frames and unsafe completion cannot supply results', () => {
  for (const events of [pair(), [...pair(), { ...done, continuationSafe: false }], [...pair(), { ...done, stopReason: 'end_turn' }],
    [...pair(), { type: 'tool_use', id: 'pending', name: 'delete_thing' }, done],
    [pair()[0], { ...pair()[1], needsConfirmation: true }, done], [...pair(), done, { type: 'delta', text: 'late' }]]) {
    assert.deepEqual(checkpointToolResults(wire(events)), []);
  }
  assert.deepEqual(checkpointToolResults(wire(pair()) + '{'), []);
  assert.deepEqual(checkpointToolResults(wire([pair()[1], done])), []);
});

test('fresh crystal reads stay on the revision-checked restoration path and results have bounded budgets', () => {
  assert.deepEqual(checkpointToolResults(wire([...pair('page', 'get_thing'), done])), []);
  assert.deepEqual(checkpointToolResults(wire([...pair('huge', 'run_action', 'x'.repeat(21 * 1024)), done])), []);
  const results = checkpointToolResults(wire([...Array.from({ length: 20 }, (_, n) => pair(String(n), 'inspect_action', 'x'.repeat(10_000))).flat(), done]));
  assert.ok(results.length <= 8);
  assert.ok(Buffer.byteLength(JSON.stringify(results)) < 64 * 1024);
  assert.equal(results.at(-1)?.id, '19');
});
