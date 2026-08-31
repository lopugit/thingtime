import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  MAX_LIMITLESS_MUTATION_OPERATIONS,
  buildLimitlessMutationPreview,
  renderThingtimeMcpUi,
  compileThingtimeCapability,
  normalizeLimitlessMutationOperations
} from './pluginLimitlessCore';

const MCP_LAB_SCRIPT_HASH = 'sha256-InujfRsBJ3VWJN0FJ9O1huZAeiHmJtIQbhm2Q3ZHwxE=';

test('the Limitless Lab CSP hash matches the shipped MCP App module', () => {
  const script = renderThingtimeMcpUi().match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'review app module is present');
  assert.equal(`sha256-${createHash('sha256').update(script).digest('base64')}`, MCP_LAB_SCRIPT_HASH);
});

test('mutation plans are bounded, assign stable create ids, and touch each Thing once', () => {
  const normalized = normalizeLimitlessMutationOperations([
    { action: 'create', thing: { thingtime: ['data'], crystal: { name: 'One' } } },
    { action: 'update', id: 'existing', patch: { crystal: { done: true } } }
  ]);
  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.equal(typeof normalized.value[0].id, 'string');
    assert.equal(normalized.value[0].thing?.shareId, normalized.value[0].id);
  }
  assert.equal(normalizeLimitlessMutationOperations([
    { action: 'update', id: 'same', patch: {} },
    { action: 'delete', id: 'same' }
  ]).ok, false);
  assert.equal(normalizeLimitlessMutationOperations(
    Array.from({ length: MAX_LIMITLESS_MUTATION_OPERATIONS + 1 }, (_, index) => ({ action: 'delete', id: `thing-${index}` }))
  ).ok, false);
  assert.equal(normalizeLimitlessMutationOperations([
    { action: 'delete', id: 'one', expectedUpdatedAt: 'not-a-date' }
  ]).ok, false);
});

test('mutation previews capture before, after, preconditions, and a reverse-order undo plan', () => {
  const built = buildLimitlessMutationPreview({
    accountId: 'personal',
    now: new Date('2026-08-30T00:00:00.000Z'),
    operations: [
      { action: 'update', id: 'one', patch: { crystal: { done: true } } },
      { action: 'delete', id: 'two' }
    ],
    beforeById: new Map([
      ['one', { id: 'one', thingtime: ['data'], targetId: 'project-1', crystal: { name: 'One', done: false }, updatedAt: '2026-08-29T00:00:00.000Z' }],
      ['two', { id: 'two', thingtime: ['data'], crystal: { name: 'Two' }, updatedAt: '2026-08-29T01:00:00.000Z' }]
    ])
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.value.operations[0].expectedUpdatedAt, '2026-08-29T00:00:00.000Z');
  assert.deepEqual(built.value.operations[0].after?.crystal, { name: 'One', done: true });
  assert.deepEqual(built.value.inverseOperations.map((operation) => [operation.action, operation.id]), [
    ['create', 'two'],
    ['update', 'one']
  ]);
  assert.deepEqual(built.value.inverseOperations[1].patch?.thingtime, ['data']);
  assert.equal(built.value.inverseOperations[1].patch?.targetId, 'project-1');
});

test('previewed updates fail closed when the exact version is missing or already stale', () => {
  const withoutVersion = buildLimitlessMutationPreview({
    accountId: 'personal',
    operations: [{ action: 'update', id: 'one', patch: { crystal: { done: true } } }],
    beforeById: new Map([['one', { id: 'one', crystal: { done: false } }]])
  });
  assert.deepEqual(withoutVersion, { ok: false, error: 'thing_missing_updated_at:one' });

  const stale = buildLimitlessMutationPreview({
    accountId: 'personal',
    operations: [{ action: 'delete', id: 'one', expectedUpdatedAt: '2026-08-28T00:00:00.000Z' }],
    beforeById: new Map([['one', { id: 'one', crystal: {}, updatedAt: '2026-08-29T00:00:00.000Z' }]])
  });
  assert.deepEqual(stale, { ok: false, error: 'thing_changed:one' });
});

test('Capability Things compile only registered bounded mutations and exact input placeholders', () => {
  const compiled = compileThingtimeCapability({
    thing: {
      id: 'capability-1',
      thingtime: ['data'],
      crystal: {
        schema: 'Thingtime Capability',
        capabilityVersion: 1,
        name: 'Archive an item',
        operations: [{ action: 'update', id: { $input: 'thingId' }, patch: { crystal: { archived: { $input: 'archived' } } } }]
      }
    },
    inputs: { thingId: 'todo-1', archived: true }
  });
  assert.deepEqual(compiled, {
    ok: true,
    value: {
      name: 'Archive an item',
      operations: [{ action: 'update', id: 'todo-1', patch: { crystal: { archived: true } } }]
    }
  });

  const unsafe = compileThingtimeCapability({
    thing: {
      thingtime: ['data'],
      crystal: {
        schema: 'Thingtime Capability',
        capabilityVersion: 1,
        operations: [{ action: 'update', id: 'todo-1', patch: { crystal: { exploit: { $where: 'run code' } } } }]
      }
    },
    inputs: {}
  });
  assert.equal(unsafe.ok, false);
  if (!unsafe.ok) assert.match(unsafe.error, /only use the exact/);
});
