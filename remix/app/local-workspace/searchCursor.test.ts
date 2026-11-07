import assert from 'node:assert/strict';
import test from 'node:test';
import { readWorkspaceSearchCursor, workspaceSearchCursor } from './searchCursor';

test('combined search continuations bind the account scope and filters without losing Unicode', () => {
 const query = { q: '🌈'.repeat(100), thingtime: 'data,component' };
 const pending = 'local-search:' + JSON.stringify([JSON.stringify([query.q, ['component', 'data']]), 'local-id']);
 const cursor = workspaceSearchCursor('owner:plane', query, 'remote-token', pending)!;
 const parsed = readWorkspaceSearchCursor(cursor, 'owner:plane', query);
 assert.equal(parsed?.remote, 'remote-token'); assert.equal(parsed?.pending, pending);
 assert.throws(() => readWorkspaceSearchCursor(cursor, 'other:plane', query), /scope or filters/);
 assert.throws(() => readWorkspaceSearchCursor(cursor, 'owner:plane', { ...query, q: 'changed' }), /scope or filters/);
 assert.throws(() => readWorkspaceSearchCursor('x'.repeat(8193), 'owner:plane', query), /scope or filters/);
 assert.throws(() => readWorkspaceSearchCursor(cursor.replace(pending.slice(0, 13), 'remote-token:'), 'owner:plane', query), /scope or filters/);
 assert.equal(workspaceSearchCursor('owner:plane', query, null, null), null);
 assert.equal(readWorkspaceSearchCursor(pending, 'owner:plane', query), null);
});
