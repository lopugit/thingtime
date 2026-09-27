import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimelineBranch, parseTimelineBranchHead, parseTimelineBranchEntry, parseTimelineBranchCommand, timelineBranchHeadId } from './branches.ts';
const branchId = 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5';
const branch = { formatVersion: 1, id: branchId, ownerId: 'owner', name: 'Design experiment', createdAt: '2026-09-27T05:00:00.000Z' };
const head = (thingId: string) => ({ formatVersion: 1, id: timelineBranchHeadId(branchId, thingId), branchId, thingId, ownerId: 'owner', eventId: `version-${thingId}`, revision: 1, createdAt: branch.createdAt, updatedAt: branch.createdAt });
const command = { command: 'create-branch', operationId: '177abf25-b322-4ac0-9707-a59c36e7bcd5', branchId, thingId: 'page', eventId: 'version', expectedRevision: 0, name: 'Design experiment' };

test('one branch can relate to multiple Things through separate head records in the shared schema', () => {
	const metadata = parseTimelineBranch(branch); const page = parseTimelineBranchHead(head('page')); const component = parseTimelineBranchHead(head('component'));
	assert.notEqual(page.id, component.id); assert.equal(page.branchId, component.branchId);
	assert.deepEqual(parseTimelineBranchEntry({ branch: metadata, head: page }), { branch, head: head('page') });
	assert.deepEqual(Object.keys(metadata).sort(), ['createdAt', 'formatVersion', 'id', 'name', 'ownerId']);
	assert.deepEqual(parseTimelineBranchHead(JSON.parse(JSON.stringify(component))), component);
});
test('branch commands and records refuse ambiguous identity, ownership, counters and extra embedded lists', () => {
	assert.deepEqual(parseTimelineBranchCommand(command), command);
	for (const change of [{ operationId: 'retry' }, { name: ' ' }, { name: ' x ' }, { name: 'x'.repeat(81) }, { name: 'a\nb' }, { expectedRevision: 1 }, { branchId: 'main' }, { ownerId: 'other' }]) assert.throws(() => parseTimelineBranchCommand({ ...command, ...change }));
	assert.deepEqual(parseTimelineBranchCommand({ ...command, command: 'advance-branch', name: null, expectedRevision: 2 }).expectedRevision, 2);
	assert.throws(() => parseTimelineBranch({ ...branch, headIds: ['anything'] }));
	assert.throws(() => parseTimelineBranchHead({ ...head('page'), revision: Number.MAX_SAFE_INTEGER + 1 }));
	assert.throws(() => parseTimelineBranchHead({ ...head('page'), id: head('component').id }));
	assert.throws(() => parseTimelineBranchEntry({ branch: parseTimelineBranch(branch), head: parseTimelineBranchHead({ ...head('page'), ownerId: 'other' }) }), /match/);
});
