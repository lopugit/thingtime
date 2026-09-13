import assert from 'node:assert/strict';
import test from 'node:test';
import { canReadRecordingTranscript, parseTranscriptAttachmentIds, projectRecordingTranscript } from './recordingTranscriptProjection';

const owned = { ownerId: 'owner', acl: ['tt:user'] };
const attachment = { ...owned, shareId: 'audio', thingtime: ['attachment'], attachmentPurpose: 'recording', attachmentState: 'ready', crystal: { mediaKind: 'audio' } };
const comment = (text: string) => ({ ...owned, thingtime: ['comment'], targetId: 'audio', crystal: { text } });
test('bounded IDs reject malformed or unbounded lookups', () => {
	assert.deepEqual(parseTranscriptAttachmentIds('a,b,a'), ['a', 'b']);
	for (const input of ['', 'a,', '../audio', 'a'.repeat(161), Array(21).fill('a').join(',')]) assert.equal(parseTranscriptAttachmentIds(input), null);
});
test('only still-private, ready, owned standalone or correctly bound Watch audio is eligible', () => {
	assert.equal(canReadRecordingTranscript('owner', attachment, null), true);
	for (const patch of [{ ownerId: 'other' }, { acl: ['tt:all'] }, { appId: 'app' }, { deletedAt: new Date() }, { attachmentState: 'pending' }, { attachmentLinked: true }, { moderation: { status: 'blocked' } }, { targetId: 'elsewhere' }])
		assert.equal(canReadRecordingTranscript('owner', { ...attachment, ...patch }, null), false);
	const post = { ...owned, shareId: 'watch-upload-test', thingtime: ['post'], tags: ['apple-watch'] };
	const bound = { ...attachment, attachmentPurpose: 'post', targetId: post.shareId };
	assert.equal(canReadRecordingTranscript('owner', bound, post), true);
	assert.equal(canReadRecordingTranscript('owner', bound, { ...post, acl: ['tt:all'] }), false);
	assert.equal(canReadRecordingTranscript('owner', bound, { ...post, shareId: 'wrong' }), false);
});
test('committed comments retain exact part ordering, whitespace, emoji and literal markup', () => {
	const comments = new Map([
		['b', comment('🦄 Lopu transcription (2/2)\n\nworld 🥰\n<script>literal</script>')],
		['a', comment('🦄 Lopu transcription (1/2)\n\nHello ')]
	]);
	assert.equal(projectRecordingTranscript('owner', 'audio', ['a', 'b'], comments), 'Hello world 🥰\n<script>literal</script>');
	comments.set('a', comment('Edited text '));
	assert.equal(projectRecordingTranscript('owner', 'audio', ['a'], comments), 'Edited text ');
});
test('missing, deleted, shared, foreign and rebound comments cannot leak text', () => {
	for (const patch of [{ ownerId: 'other' }, { acl: ['tt:all'] }, { appId: 'app' }, { deletedAt: new Date() }, { targetId: 'wrong' }, { thingtime: ['data'] }]) {
		assert.equal(projectRecordingTranscript('owner', 'audio', ['a'], new Map([['a', { ...comment('private'), ...patch }]])), null);
	}
	assert.equal(projectRecordingTranscript('owner', 'audio', ['gone'], new Map()), null);
	assert.equal(projectRecordingTranscript('owner', 'audio', [], new Map()), null);
	assert.equal(projectRecordingTranscript('owner', 'audio', ['a'], new Map([['a', comment('x'.repeat(60_001))]])), null);
});
