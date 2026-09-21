import assert from 'node:assert/strict';
import test from 'node:test';
import { canAutomaticallyResume, continuationContext, continuationRequestId } from './continuationCore';

test('tabs derive one distinct operation per saved boundary', async () => {
	const id = await continuationRequestId('chat', 'part');
	assert.equal(id, await continuationRequestId('chat', 'part'));
	assert.notEqual(id, await continuationRequestId('chat', 'next'));
	assert.notEqual(id, await continuationRequestId('another', 'part'));
	assert.match(id, /^resume-[a-f0-9]{64}$/);
});
test('recovery strips stale drafts, attachments and page references', () => {
	const context = continuationContext({
		route: '/build',
		viewport: 'mobile',
		pages: [{ url: '/old' }],
		page: { id: 'page', blocks: [{ private: 'old draft' }], source: 'thing' }
	});
	assert.deepEqual(context, { route: '/build', viewport: 'mobile', page: { id: 'page', source: 'thing', pageKey: undefined, siteRoute: undefined } });
	assert.equal(continuationContext({ page: { blocks: ['unsaved'] } }).page, undefined);
});
test('only explicit persisted safe boundaries allow automatic recovery', () => {
	for (const stopReason of ['checkpoint', 'tool_limit', 'hop_limit', 'time_limit', 'max_tokens', 'error']) {
		assert.equal(canAutomaticallyResume({ stopReason, continuationSafe: true }), true);
		assert.equal(canAutomaticallyResume({ stopReason }), false);
	}
	for (const stopReason of ['end_turn', 'aborted', 'confirm']) assert.equal(canAutomaticallyResume({ stopReason, continuationSafe: true }), false);
});

test('saved error streak bounds recovery across independent callers', () => {
 const checkpoint = { stopReason: 'error', continuationSafe: true, recoveryFailures: 4 };
 assert.equal(canAutomaticallyResume(checkpoint), true);
 assert.equal(canAutomaticallyResume({ ...checkpoint, recoveryFailures: 5 }), false);
 assert.equal(canAutomaticallyResume({ ...checkpoint, recoveryFailures: 500 }), false);
 assert.equal(canAutomaticallyResume({ ...checkpoint, stopReason: 'checkpoint', recoveryFailures: 0 }), true);
});
