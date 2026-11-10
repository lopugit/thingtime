import test from 'node:test';
import assert from 'node:assert/strict';
import { simpleParser } from 'mailparser';
import { gmailMutation } from '~/mail/googleModel';
import { applyGoogleMailMutation, gmailRaw } from './googleActions';
import { MailActionError } from '~/mail/model';
const account: any = { address: 'owner@example.com' };
const compose = { to: 'reader@example.com', cc: '', bcc: 'hidden@example.com', subject: 'Hello 🌈', text: 'Body\nSecond line' };
const draft = { id: 'draft_123', message: { id: 'message_123', raw: gmailRaw(account.address, compose, 'fixture-id') } };
test('outgoing MIME preserves Unicode and explicit recipients while rejecting injected headers', async () => {
	const parsed = await simpleParser(Buffer.from(gmailRaw(account.address, compose, 'fixture-id'), 'base64url'));
	assert.equal(parsed.subject, compose.subject);
	const longSubject = '🌈 Long multilingual subject 日本語 '.repeat(12);
	const longRaw = Buffer.from(gmailRaw(account.address, { ...compose, subject: longSubject }, 'fixture-long'), 'base64url');
	assert.equal((await simpleParser(longRaw)).subject, longSubject);
	assert.ok(
		longRaw
			.toString()
			.split('\r\n')
			.every((line) => Buffer.byteLength(line) < 998)
	);
	assert.match(parsed.text!, /Second line/);
	assert.equal(parsed.bcc && !Array.isArray(parsed.bcc) && parsed.bcc.value[0].address, 'hidden@example.com');
	assert.throws(() =>
		gmailMutation({
			action: 'send',
			draftId: 'draft_123',
			messageId: 'message_123',
			compose: { ...compose, to: 'reader@example.com\r\nBcc: injected@example.com' }
		})
	);
	assert.throws(() =>
		gmailMutation({ action: 'send', draftId: 'draft_123', messageId: 'message_123', compose: { ...compose, subject: 'Hi\nBcc: bad@example.com' } })
	);
	assert.throws(() => gmailMutation({ action: 'permanent-delete', remoteId: 'message_123' }));
	assert.throws(() => gmailMutation({ action: 'label-remove', remoteId: 'message_123', labelId: 'SENT' }));
});
test('sending validates the saved draft identity and sends only explicit composer fields', async () => {
	const writes: any[] = [];
	const result = await applyGoogleMailMutation(
		account,
		gmailMutation({ action: 'send', draftId: draft.id, messageId: draft.message.id, compose }),
		'op-123',
		undefined,
		async () => async (path, method, body) => {
			if (method === 'POST') {
				writes.push({ path, body });
				return { id: 'sent_123' };
			}
			return draft;
		}
	);
	assert.equal(result.sentId, 'sent_123');
	assert.equal(writes.length, 1);
	assert.equal(writes[0].path, 'drafts/send');
	const sent = await simpleParser(Buffer.from(writes[0].body.message.raw, 'base64url'));
	assert.equal(sent.subject, compose.subject);
	await assert.rejects(
		applyGoogleMailMutation(
			account,
			gmailMutation({ action: 'send', draftId: draft.id, messageId: 'stale_message', compose }),
			'op-123',
			undefined,
			async () => async () => draft
		),
		(error: any) => error instanceof MailActionError && error.actionOutcome === 'not-applied'
	);
});
test('transport failure after a send is uncertain and never retried inside the adapter', async () => {
	let sends = 0;
	await assert.rejects(
		applyGoogleMailMutation(
			account,
			gmailMutation({ action: 'send', draftId: draft.id, messageId: draft.message.id, compose }),
			'op-123',
			undefined,
			async () => async (_path, method) => {
				if (method === 'POST') {
					sends++;
					throw new Error('provider-token-private');
				}
				return draft;
			}
		),
		(error: any) => error.actionOutcome === 'uncertain' && !error.message.includes('provider-token-private')
	);
	assert.equal(sends, 1);
});
test('mailbox actions use bounded Gmail endpoints and whitelist label changes', async () => {
	for (const action of ['read', 'unread', 'archive', 'trash', 'untrash', 'label-add', 'label-remove']) {
		const calls: any[] = [];
		await applyGoogleMailMutation(
			account,
			gmailMutation({ action, remoteId: 'message_123', labelId: 'Label_123' }),
			'op-123',
			undefined,
			async () => async (path, method, body) => {
				calls.push({ path, method, body });
				return { id: 'message_123', labelIds: ['INBOX'] };
			}
		);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].method, 'POST');
		assert.equal(calls[0].path.includes('/delete'), false);
		if (action === 'archive') assert.deepEqual(calls[0].body.removeLabelIds, ['INBOX']);
		if (action === 'unread') assert.deepEqual(calls[0].body.addLabelIds, ['UNREAD']);
	}
});
