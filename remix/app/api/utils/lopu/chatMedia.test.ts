import assert from 'node:assert/strict';
import test from 'node:test';
import { anthropicMediaContent, openAiMediaContent, readBoundedResponse } from './chatMedia';
import { parseLopuNetworkRequest } from './networkCore';
import { confirmationFor, createLopuToolContext, runLopuTool, validateLopuToolInput } from './chatTools';

test('image pixels and PDF bytes are provider input blocks rather than metadata labels', () => {
	const files = [
		{ name: 'photo.png', contentType: 'image/png', data: 'cGl4ZWxz' },
		{ name: 'notes.pdf', contentType: 'application/pdf', data: 'cGRm' }
	];
	const claude = anthropicMediaContent('Read these', files);
	assert.equal(claude[1].source.data, files[0].data);
	assert.equal(claude[1].type, 'image');
	assert.equal(claude[2].type, 'document');
	const openai = openAiMediaContent('Read these', files);
	assert.equal(openai[1].image_url.url, 'data:image/png;base64,cGl4ZWxz');
	assert.equal(openai[2].file.file_data, 'data:application/pdf;base64,cGRm');
	assert.equal(anthropicMediaContent('plain'), 'plain');
	assert.equal(openAiMediaContent('plain'), 'plain');
});

test('stream byte limit cancels oversized bodies without trusting content length', async () => {
	assert.equal(new TextDecoder().decode(await readBoundedResponse(new Response('hello'), 5)), 'hello');
	await assert.rejects(readBoundedResponse(new Response('too large', { headers: { 'content-length': '1' } }), 3), /limit/);
});

test('HTTP inputs reject ambient credentials and invalid transport/body shapes', () => {
	for (const input of [
		{ url: 'http://example.com' },
		{ url: 'https://user:pass@example.com' },
		{ url: 'https://example.com:8443' },
		{ url: 'https://example.com', headers: { cookie: 'session=secret' } },
		{ url: 'https://example.com', headers: { host: 'localhost' } },
		{ url: 'https://example.com', body: 'x' },
		{ url: 'https://example.com', method: 'POST', body: 'x'.repeat(32769) }
	])
		assert.throws(() => parseLopuNetworkRequest(input));
	assert.equal(parseLopuNetworkRequest({ url: 'https://example.com', method: 'post', body: '{}' }).method, 'POST');
	const read = validateLopuToolInput('fetch_url', { url: 'https://example.com', method: 'DELETE', headers: { authorization: 'secret' } });
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.equal(read.input.method, 'GET');
		assert.deepEqual(read.input.headers, {});
	}
});

test('external API requests stop before network until the exact request is confirmed', async () => {
	const input = parseLopuNetworkRequest({ url: 'https://example.com', method: 'POST', body: '{"one":1}' });
	const action = confirmationFor('http_request', input)!;
	assert.notEqual(action.key, confirmationFor('http_request', { ...input, body: '{"one":2}' })!.key);
	const ctx = createLopuToolContext({ id: 'viewer', username: 'viewer' }, null, () => {});
	const result = await runLopuTool({ id: 'test', name: 'http_request', input }, ctx);
	assert.equal(result.ok, false);
	assert.equal(result.needsConfirmation, true);
});

test('OAuth tool hops retain image/PDF inputs as binary blocks, not base64 transcript text', async () => {
	const { claudeOAuthPrompt } = await import('../ai/claudeOAuthPrompt');
	const prompt = claudeOAuthPrompt([
		{
			role: 'user',
			content: anthropicMediaContent('inspect', [
				{ name: 'a.png', contentType: 'image/png', data: 'cGl4ZWxz' },
				{ name: 'a.pdf', contentType: 'application/pdf', data: 'cGRm' }
			])
		},
		{ role: 'assistant', content: [{ type: 'tool_use', id: 'tool', name: 'get_thing', input: { id: 'one' } }] },
		{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'result' }] }
	]);
	assert.equal((prompt.message.content[1] as any).type, 'image');
	assert.equal((prompt.message.content[2] as any).type, 'document');
	assert.doesNotMatch((prompt.message.content[0] as any).text, /cGl4ZWxz|cGRm/);
});
