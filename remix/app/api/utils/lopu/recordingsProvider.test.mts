import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { recordingFailureMessage } from './recordingsCore';

let download: any;
let settings: any;
let resolved: string[];
mock.module(new URL('../attachments/attachments.ts', import.meta.url).href, {
	namedExports: {
		getAttachmentDownload: async (viewer: any, id: string, force: boolean) => {
			assert.deepEqual(viewer, { id: 'owner' });
			assert.equal(id, 'attachment');
			assert.equal(force, false);
			return download;
		}
	}
});
mock.module(new URL('../settings/prConflictResolverModelWaterfall.ts', import.meta.url).href, {
	namedExports: { getAiPreferredModelWaterfall: async () => [] }
});
mock.module(new URL('./recordingsStore.ts', import.meta.url).href, {
	namedExports: { getRecordingSettings: async () => settings }
});
mock.module(new URL('./recordingsConnections.ts', import.meta.url).href, {
	namedExports: {
		resolveRecordingConnection: async (ownerId: string, id: string) => {
			assert.equal(ownerId, 'owner');
			resolved.push(id);
			return {
				id,
				name: id,
				provider: id === 'claude' ? 'anthropic' : 'openai',
				token: `synthetic-${id}`,
				endpoint: `https://${id}.example.test`,
				model: null
			};
		}
	}
});
const { readRecordingBytes, transcribeRecording, analyzeRecording } = await import('./recordingsProvider');

beforeEach(() => {
	download = { ok: true, size: 3, contentType: 'audio/wav', url: 'https://storage.example.test/audio?signature=private' };
	settings = { enabled: true, createNotes: true, createTodos: true, transcriptionProviders: ['limited', 'working'], analysisProviders: ['limited', 'claude'] };
	resolved = [];
});

test('real SDK transcription falls through 429 to the next selected key without duplicate attempts', async () => {
	const requests: string[] = [];
	let guards = 0;
	mock.method(globalThis, 'fetch', async (url: any, options: any) => {
		// The SDK probes multipart support with an in-memory data URL.
		if (String(url).startsWith('data:')) return new Response('');
		const host = new URL(String(url)).hostname;
		requests.push(host);
		assert.equal(options.redirect, 'error');
		if (host === 'storage.example.test') return new Response(new Uint8Array([1, 2, 3]));
		assert.equal(new Headers(options.headers).get('authorization'), `Bearer synthetic-${host.split('.')[0]}`);
		assert.ok(options.signal);
		if (host === 'limited.example.test') return Response.json({ error: { message: 'synthetic private error' } }, { status: 429 });
		return Response.json({ text: 'Buy bike tubes.' });
	});
	assert.equal(
		await transcribeRecording('owner', 'attachment', async () => {
			guards++;
		}),
		'Buy bike tubes.'
	);
	assert.deepEqual(resolved, ['limited', 'working']);
	assert.deepEqual(requests, ['storage.example.test', 'limited.example.test', 'working.example.test']);
	assert.equal(guards, 2);
});

test('analysis can fall through to a Claude API key without sending audio or enabling tools', async () => {
	const transcript = 'Please buy bike tubes.';
	mock.method(globalThis, 'fetch', async (url: any, options: any) => {
		assert.equal(options.redirect, 'error');
		if (new URL(String(url)).hostname === 'limited.example.test') return Response.json({ error: { message: 'quota' } }, { status: 429 });
		assert.equal(new Headers(options.headers).get('x-api-key'), 'synthetic-claude');
		const body = JSON.parse(options.body);
		assert.equal(body.tools, undefined);
		assert.deepEqual(body.messages, [{ role: 'user', content: transcript }]);
		return Response.json({
			content: [
				{ type: 'text', text: JSON.stringify({ items: [{ kind: 'todo', title: 'Buy bike tubes', description: '', evidence: 'buy bike tubes' }] }) }
			]
		});
	});
	const insights = await analyzeRecording(transcript, async () => {}, 'owner');
	assert.equal(insights[0].title, 'Buy bike tubes');
	assert.deepEqual(resolved, ['limited', 'claude']);
});

test('changing the provider selection after a failure stops before resolving another key', async () => {
	mock.method(globalThis, 'fetch', async () => {
		settings.analysisProviders = ['working'];
		return Response.json({ error: { message: 'quota' } }, { status: 429 });
	});
	await assert.rejects(
		analyzeRecording('Please buy bike tubes.', async () => {}, 'owner'),
		/consent or provider selection changed/
	);
	assert.deepEqual(resolved, ['limited']);
});
afterEach(() => mock.restoreAll());

test('turning off both analysis outputs prevents fallback from sending another transcript', async () => {
	mock.method(globalThis, 'fetch', async () => {
		settings.createNotes = false;
		settings.createTodos = false;
		return Response.json({ error: { message: 'quota' } }, { status: 429 });
	});
	await assert.rejects(analyzeRecording('Please buy bike tubes.', async () => {}, 'owner'), /consent or provider selection changed/);
	assert.deepEqual(resolved, ['limited']);
});

test('recording download uses the authorized attachment and requires its exact byte length', async () => {
	mock.method(globalThis, 'fetch', async (_url: unknown, options: any) => {
		assert.equal(options.redirect, 'error');
		return new Response(new Uint8Array([1, 2, 3]));
	});
	const result = await readRecordingBytes('owner', 'attachment');
	assert.deepEqual(Array.from(result.bytes), [1, 2, 3]);
	assert.equal(result.type, 'audio/wav');
});

test('storage HTTP and network failures expose only the download category', async () => {
	const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
	const check = (error: unknown) => {
		const message = recordingFailureMessage(error);
		assert.match(message, /download the saved audio/);
		assert.doesNotMatch(message, /signature|private credential/);
		return true;
	};
	await assert.rejects(readRecordingBytes('owner', 'attachment'), check);
	fetchMock.mock.mockImplementation(async () => {
		throw new Error('private credential in signed URL');
	});
	await assert.rejects(readRecordingBytes('owner', 'attachment'), check);
});

test('truncated or oversized storage responses never reach transcription', async () => {
	const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1, 2])));
	await assert.rejects(readRecordingBytes('owner', 'attachment'), /download/);
	fetchMock.mock.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3, 4])));
	await assert.rejects(readRecordingBytes('owner', 'attachment'), /download/);
});

test('unavailable sources and unsupported formats are distinguished without a storage fetch', async () => {
	const fetchMock = mock.method(globalThis, 'fetch', async () => {
		throw new Error('must not fetch');
	});
	download = { ok: false, error: 'private internal detail' };
	await assert.rejects(readRecordingBytes('owner', 'attachment'), /no longer available/);
	download = { ok: true, contentType: 'text/html', size: 3 };
	await assert.rejects(readRecordingBytes('owner', 'attachment'), /format or size/);
	assert.equal(fetchMock.mock.callCount(), 0);
});
