import assert from 'node:assert/strict';
import test from 'node:test';
import { importConfiguredOpenAiCredential } from './credentialVault';
import { createCredentialAction } from '../../../routes/api/v1/admin/ci/credentials/_credentials';
const secret = 'sk-synthetic-test-only';
const metadata = {
	id: 'one',
	name: 'OPENAI_THINGTIME_API_KEY',
	platform: 'OpenAI',
	credentialType: 'openai-api-key',
	enabled: true,
	priority: 4,
	createdAt: new Date(),
	updatedAt: new Date(),
	createdBy: 'admin'
};
function fixture() {
	let existing: any = null;
	const calls: any[] = [];
	const deps = {
		collection: async () => ({ findOne: async () => existing } as any),
		value: () => secret as string | undefined,
		create: async (input: any, actor: string) => {
			calls.push({ input, actor });
			existing = { ...metadata, cipherText: 'encrypted', iv: 'iv', tag: 'tag' };
			return metadata as any;
		}
	};
	return {
		deps,
		calls,
		setExisting: (row: any) => {
			existing = row;
		}
	};
}
test('imports only configured key, returns metadata, and repeated import preserves entry', async () => {
	const f = fixture();
	const first = await importConfiguredOpenAiCredential('admin', f.deps);
	assert.deepEqual(f.calls, [{ input: { name: metadata.name, platform: 'OpenAI', value: secret, enabled: true }, actor: 'admin' }]);
	assert.doesNotMatch(JSON.stringify(first), /sk-synthetic|encrypted/);
	const second = await importConfiguredOpenAiCredential('admin', f.deps);
	assert.equal(second.id, first.id);
	assert.equal(f.calls.length, 1);
	assert.doesNotMatch(JSON.stringify(second), /cipherText|"iv"|"tag"|sk-synthetic/);
});
test('missing key and conflicting platform never write; disabled entries stay disabled', async () => {
	const f = fixture();
	f.deps.value = () => undefined;
	await assert.rejects(importConfiguredOpenAiCredential('admin', f.deps), /no configured/);
	f.setExisting({ ...metadata, platform: 'Anthropic' });
	await assert.rejects(importConfiguredOpenAiCredential('admin', f.deps), /another platform/);
	f.setExisting({ ...metadata, enabled: false });
	assert.equal((await importConfiguredOpenAiCredential('admin', f.deps)).enabled, false);
	assert.equal(f.calls.length, 0);
});
test('concurrent import returns existing winner without rotating it', async () => {
	const f = fixture();
	f.deps.create = async () => {
		f.setExisting(metadata);
		throw new Error('duplicate');
	};
	assert.equal((await importConfiguredOpenAiCredential('admin', f.deps)).id, 'one');
});
const post = (origin = 'https://thingtime.example') =>
	new Request('https://thingtime.example/api/v1/admin/ci/credentials', {
		method: 'POST',
		headers: { Origin: origin, 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'import-configured-openai', value: 'ignored-untrusted', source: 'OTHER_SECRET' })
	});
test('route enforces admin and same origin before import; response is private and redacted', async () => {
	let calls = 0;
	const deps: any = {
		requireAdmin: async () => ({ user: { id: 'admin' } }),
		importConfiguredOpenAiCredential: async (actor: string) => {
			assert.equal(actor, 'admin');
			calls++;
		},
		listLopuCredentials: async () => ({ vaultConfigured: true, credentials: [metadata] }),
		resetAiProviderProbeCache: () => {}
	};
	const action = createCredentialAction(deps);
	let result = await action({ request: post() });
	assert.equal(result.status, 200);
	assert.equal(calls, 1);
	assert.match(result.headers.get('Cache-Control')!, /no-store/);
	assert.doesNotMatch(await result.text(), /sk-synthetic|ignored-untrusted/);
	result = await action({ request: post('https://evil.example') });
	assert.equal(result.status, 403);
	assert.equal(calls, 1);
	deps.requireAdmin = async () => ({ error: { status: 403, message: 'Admins only' } });
	result = await action({ request: post() });
	assert.equal(result.status, 403);
	assert.equal(calls, 1);
});
test('unexpected import errors cannot disclose key values', async () => {
	const action = createCredentialAction({
		requireAdmin: async () => ({ user: { id: 'admin' } }),
		importConfiguredOpenAiCredential: async () => {
			throw new Error(secret);
		},
		listLopuCredentials: async () => {
			throw new Error('unreachable');
		},
		resetAiProviderProbeCache: () => {}
	} as any);
	const result = await action({ request: post() });
	assert.equal(result.status, 409);
	assert.doesNotMatch(await result.text(), /sk-synthetic/);
});
