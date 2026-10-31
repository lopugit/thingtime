import assert from 'node:assert/strict';
import test from 'node:test';
import { createSystemEnvironmentStore, publicEnvironmentEntry } from './systemEnvironment';
const entry = {
	id: 'env_example',
	key: 'SERVICE_TOKEN',
	target: ['preview'],
	type: 'encrypted',
	gitBranch: 'feature',
	value: 'must-never-list',
	decrypted: true
};

test('environment metadata is explicitly projected and sensitive values cannot be revealed', async () => {
	assert.equal('value' in publicEnvironmentEntry(entry), false);
	assert.equal('decrypted' in publicEnvironmentEntry(entry), false);
	let calls = 0;
	const store = createSystemEnvironmentStore({
		project: 'prj_test',
		token: 'private',
		fetch: async (url, init) => {
			calls++;
			assert.equal(new URL(String(url)).origin, 'https://api.vercel.com');
			assert.equal(new URL(String(url)).searchParams.get('decrypt'), 'false');
			assert.equal(init?.redirect, 'error');
			return Response.json({ envs: [{ ...entry, type: 'sensitive' }] });
		}
	});
	assert.equal(await store.reveal(entry.id), null);
	assert.equal(calls, 1);
});

test('writes stay in the configured project and rotation preserves scope', async () => {
	const calls: any[] = [];
	const store = createSystemEnvironmentStore({
		project: 'prj_test',
		team: 'team_test',
		token: 'private',
		fetch: async (url, init) => {
			calls.push({ url: String(url), method: init?.method, body: init?.body });
			return Response.json(init?.method === 'GET' ? { envs: [entry] } : { value: 'never-return' });
		}
	});
	assert.equal(await store.mutate({ action: 'rotate', id: entry.id, value: 'replacement' }), undefined);
	assert.match(calls[1].url, /\/v9\/projects\/prj_test\/env\/env_example\?teamId=team_test/);
	assert.deepEqual(JSON.parse(calls[1].body), { value: 'replacement' });
	await assert.rejects(store.mutate({ action: 'create', key: 'ANTHROPIC_API_KEY', value: 'bad', target: 'production' }));
	await assert.rejects(store.mutate({ action: 'create', key: 'X', value: 'value', target: 'production', project: 'other' }));
	await assert.rejects(store.mutate({ action: 'rotate', id: '../other', value: 'value' }));
});

test('provider errors never expose upstream values or credential diagnostics', async () => {
	const store = createSystemEnvironmentStore({
		project: 'prj_test',
		token: 'private',
		fetch: async () => new Response('private-secret', { status: 403 })
	});
	await assert.rejects(store.list(), (error: any) => !error.message.includes('private-secret') && /project access/.test(error.message));
});
