import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmationFor, createLopuToolContext, runLopuTool, validateLopuToolInput } from './chatTools';

test('comment tools accept a target relationship, never parent data or audience overrides', () => {
	assert.deepEqual(validateLopuToolInput('comment_on_thing', { id: 'target', text: ' Context ', ownerId: 'other', crystal: { overwritten: true }, acl: ['tt:all'] }), { ok: true, input: { id: 'target', text: 'Context' } });
	assert.equal(validateLopuToolInput('comment_on_thing', { id: 'target', text: 'x'.repeat(3901) }).ok, false);
	assert.equal(validateLopuToolInput('comment_on_thing', { id: 'target', text: ' ' }).ok, false);
	assert.deepEqual(validateLopuToolInput('list_thing_comments', { id: 'target', limit: 999, ownerId: 'other' }), { ok: true, input: { id: 'target', cursor: undefined, limit: 20 } });
});

test('shared-comment confirmations bind both target and exact comment text', () => {
	const key = confirmationFor('comment_on_thing', { id: 'one', text: 'A' })!.key;
	assert.notEqual(key, confirmationFor('comment_on_thing', { id: 'two', text: 'A' })!.key);
	assert.notEqual(key, confirmationFor('comment_on_thing', { id: 'one', text: 'B' })!.key);
});

test('Lopu comments always stop for confirmation before any database access', async () => {
	const events: any[] = [];
	const context = createLopuToolContext({ id: 'owner', username: 'owner' }, null, event => events.push(event));
	await runLopuTool({ id: 'comment', name: 'comment_on_thing', input: { id: 'target', text: 'Useful context', confirmed: true } }, context);
	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'confirm');
	assert.equal(events[0].key, confirmationFor('comment_on_thing', { id: 'target', text: 'Useful context' })!.key);
});

test('scheduled update mode refuses mutations before loading database dependencies', async () => {
	const context = createLopuToolContext({ id: 'owner', username: 'owner' }, null, () => {}, { readOnly: true });
	for (const name of ['comment_on_thing', 'create_thing', 'create_reminder', 'run_action', 'delete_thing']) {
		const result = await runLopuTool({ id: name, name, input: {} }, context);
		assert.equal(result.ok, false);
		assert.match((result as any).error, /Scheduled updates/);
	}
});
