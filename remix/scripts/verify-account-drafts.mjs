#!/usr/bin/env node
// Real API regression run. Create a disposable local seed with seed-fixture.mjs,
// then pass its ignored fixture JSON. Never reads/writes MongoDB directly.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { makePng } from './seed-fixture.mjs';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync(process.argv[2] || '.fixtures/account-drafts.json', 'utf8'));
const base = new URL(fixture.base);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Run against an isolated local development API');
const client = () => {
	const cookies = new Map();
	return async (route, method = 'GET', body, expected = 200) => {
		const response = await fetch(new URL(route, base), {
			method,
			signal: AbortSignal.timeout(30000),
			headers: { Origin: base.origin, 'Content-Type': 'application/json', Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		for (const header of response.headers.getSetCookie()) {
			const [pair] = header.split(';'),
				i = pair.indexOf('=');
			cookies.set(pair.slice(0, i), pair.slice(i + 1));
		}
		const data = await response.json();
		assert.equal(response.status, expected, `${method} ${route}: ${data?.error || response.status}`);
		return data;
	};
};
const owner = client(),
	stranger = client(),
	anon = client();
await owner('/api/v1/login', 'POST', { username: fixture.username, password: fixture.password });
const otherName = `draftqa-${randomBytes(5).toString('hex')}`;
const registered = await stranger('/api/v1/auth/register', 'POST', {
	username: otherName,
	password: randomBytes(24).toString('base64url'),
	email: `${otherName}@example.test`
});
const drafts = '/api/v1/drafts';
const send = (input, status = 200) => owner(drafts, 'POST', { expectedActor: fixture.userId, ...input }, status);
const content = {
	surface: 'post',
	context: 'post:new:',
	name: 'Unfinished price and rich text',
	snapshot: JSON.stringify({
		price: '12.',
		title: 'Partial listing',
		pollOptions: ['One', ''],
		postEditorValue: { kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: 'Keep this draft' } }] }
	}),
	attachmentIds: []
};
const id = randomUUID(),
	writeId = randomUUID();
const first = await send({ operation: 'save', id, revision: 0, writeId, content });
assert.equal(first.draft.revision, 1);
const retry = await send({ operation: 'save', id, revision: 0, writeId, content });
assert.equal(retry.draft.revision, 1);
await send({ operation: 'save', id, revision: 0, writeId: randomUUID(), content }, 409);
const second = await send({ operation: 'save', id, revision: 1, writeId: randomUUID(), content: { ...content, name: 'Newer draft' } });
assert.equal(second.draft.revision, 2);
await anon(`${drafts}?id=${id}`, 'GET', undefined, 401);
await stranger(`${drafts}?id=${id}`, 'GET', undefined, 404);
await owner(`/api/v1/things?id=${id}`, 'GET', undefined, 404);
await send({ operation: 'save', id: randomUUID(), revision: 0, writeId: randomUUID(), content, expectedActor: 'wrong' }, 409);
const recoveredId = randomUUID();
const recovered = await send({ operation: 'recover', sourceId: id, id: recoveredId, content });
assert.equal(recovered.draft.name, content.name);
assert.equal((await send({ operation: 'recover', sourceId: id, id: recoveredId, content })).draft.id, recoveredId);

await send({operation:'delete', id: recoveredId, revision: recovered.draft.revision});
const listed = await owner(drafts);
assert.ok(listed.drafts.some((d) => d.id === id));
assert.ok(listed.drafts.every((d) => !('snapshot' in d)));
await send({ operation: 'delete', id, revision: 1 }, 409);
await send({ operation: 'delete', id, revision: 2 });
await send({ operation: 'save', id, revision: 2, writeId: randomUUID(), content }, 410);
await owner(`${drafts}?id=${id}`, 'GET', undefined, 404);
const templateId = randomUUID();
const template = await send({ operation: 'from-post', id: templateId, postId: fixture.postId });
assert.equal(template.draft.mode, 'template');
const copyId = randomUUID();
const copy = await send({ operation: 'instantiate', sourceId: templateId, id: copyId });
assert.equal(copy.draft.mode, 'draft');
const copyAgain = await send({ operation: 'instantiate', sourceId: templateId, id: copyId });
assert.equal(copyAgain.draft.id, copyId);
await send({ operation: 'instantiate', sourceId: { $ne: null }, id: randomUUID() }, 400);
const original = await owner(`${drafts}?id=${templateId}`);
assert.equal(original.draft.mode, 'template');
await send({ operation: 'save', id: templateId, revision: 1, writeId: randomUUID(), content }, 409);
await send({ operation: 'delete', id: copyId, revision: copy.draft.revision });
await owner(`${drafts}?id=${templateId}`);
await send({ operation: 'delete', id: templateId, revision: template.draft.revision });
console.log(
	'PASS: private ownership, hidden generic read, partial fields, CAS/replay, immutable retirement, reusable templates, copy retries, conflict-copy recovery, invalid source rejection'
);

if (process.argv.includes('--media')) {
	const bytes = makePng(24, 24, 42);
	const upload = (
		await owner('/api/v1/attachments/uploads', 'POST', {
			requestId: randomUUID(),
			filename: 'draft-test.png',
			contentType: 'image/png',
			sizeBytes: bytes.length,
			purpose: 'post'
		})
	).upload;
	const parts = await owner('/api/v1/attachments/uploads/parts', 'POST', {
		uploadId: upload.id,
		parts: [{ partNumber: 1, checksumSha256: createHash('sha256').update(bytes).digest('base64') }]
	});
	const put = await fetch(new URL(parts.parts[0].url, base), { method: 'PUT', headers: parts.parts[0].headers, body: bytes });
	assert.ok(put.ok);
	const file = (await owner('/api/v1/attachments/uploads/complete', 'POST', { uploadId: upload.id })).attachment;
	const mediaId = randomUUID();
	const mediaContent = {
		...content,
		name: 'Media draft',
		attachmentIds: [file.id],
		snapshot: JSON.stringify({
			photosOn: true,
			postEditorValue: { kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: 'Media draft' } }] },
			attachments: [file]
		})
	};
	const media = await send({ operation: 'save', id: mediaId, revision: 0, writeId: randomUUID(), content: mediaContent });
	const mediaRead = await owner(`${drafts}?id=${mediaId}`);
	assert.equal(mediaRead.attachments[0].id, file.id);
	const mediaRecovery = await send({operation:'recover', sourceId:mediaId, id:randomUUID(), content:mediaContent});
assert.notEqual(mediaRecovery.draft.attachmentIds[0], file.id);
assert.equal(JSON.parse(mediaRecovery.draft.snapshot).attachments[0].id, mediaRecovery.draft.attachmentIds[0]);
await send({operation:'delete', id:mediaRecovery.draft.id, revision:mediaRecovery.draft.revision});
const sourcePost = (
		await owner('/api/v1/things', 'POST', { type: 'image', text: 'Stored draft media regression', visibility: 'private', attachmentIds: [file.id] })
	).post;
	await send({ operation: 'delete', id: mediaId, revision: media.draft.revision });
	const published = await owner(`/api/v1/things?id=${sourcePost.id}`);
	assert.equal(published.post.attachments[0].id, file.id);
	const tid = randomUUID();
	const t = await send({ operation: 'from-post', id: tid, postId: sourcePost.id });
	assert.notEqual(t.draft.attachmentIds[0], file.id);
	const instance = await send({ operation: 'instantiate', sourceId: tid, id: randomUUID() });
	assert.notEqual(instance.draft.attachmentIds[0], t.draft.attachmentIds[0]);
	const nextPost = (
		await owner('/api/v1/things', 'POST', {
			type: 'image',
			text: 'Template instance',
			visibility: 'private',
			attachmentIds: instance.draft.attachmentIds
		})
	).post;
	await send({ operation: 'delete', id: instance.draft.id, revision: instance.draft.revision });
	await owner('/api/v1/things', 'DELETE', { id: sourcePost.id });
	const templateAfter = await owner(`${drafts}?id=${tid}`);
	assert.equal(templateAfter.attachments.length, 1);
	const reusable = await send({ operation: 'instantiate', sourceId: tid, id: randomUUID() });
	assert.equal(reusable.draft.attachmentIds.length, 1);
	await owner('/api/v1/things', 'DELETE', { id: nextPost.id });
	await send({ operation: 'delete', id: reusable.draft.id, revision: reusable.draft.revision });
	await send({ operation: 'delete', id: tid, revision: t.draft.revision });
	console.log(
		'PASS: multipart upload → durable private draft → published post; independent template copies survive source deletion and repeated publication'
	);
}
