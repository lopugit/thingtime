import test from 'node:test';
import assert from 'node:assert/strict';
import { folderFor, parseMailMessage, MAIL_SOURCE_BYTES } from './provider';
test('MIME is decoded to text without rendering remote images or HTML', async () => {
	const folder = folderFor('account_one', 'imap', 'INBOX');
	const message = await parseMailMessage(
		Buffer.from(
			'From: Friend <friend@example.com>\r\nTo: me@example.com\r\nSubject: =?UTF-8?B?SGVsbG8g8J+Shg==?=\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello <b>friend</b></p><img src="https://tracker.example.com/pixel"><script>alert(1)</script>'
		),
		folder,
		'123:42'
	);
	assert.match(message.subject, /^Hello/);
	assert.match(message.text, /Hello friend/);
	assert.equal('html' in message, false);
	assert.equal(message.text.includes('<script>'), false);
	assert.notEqual(message.id, (await parseMailMessage(Buffer.alloc(0), folder, '124:42')).id, 'UIDVALIDITY prevents stale identity reuse');
});
test('message content is bounded for the shared vault envelope', async () => {
	const message = await parseMailMessage(
		Buffer.from('Content-Type: text/plain; charset=utf-8\r\n\r\n' + '🌈'.repeat(20000)),
		folderFor('account_one', 'pop3', 'INBOX'),
		'stable-uid'
	);
	assert.equal(message.truncated, true);
	assert.ok(Buffer.byteLength(JSON.stringify(message)) < 65536);
	await assert.rejects(parseMailMessage(Buffer.alloc(MAIL_SOURCE_BYTES + 1), folderFor('account_one', 'imap', 'INBOX'), '1'), /limit/);
});
