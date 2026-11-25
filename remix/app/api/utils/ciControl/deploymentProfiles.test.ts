import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createDeploymentProfileHandlers } from '../../../routes/api/v1/admin/ci/deployment-profiles/_deployment-profiles';
import { createControllerDeploymentProfilesHandler } from '../../../routes/api/v1/integrations/ci/deployment-profiles/_deployment-profiles';
import { createApiCapabilitiesManifest } from '../../../docs/apiDocs';
import { thingtimeCapabilityManifest } from '../capabilities/thingtimeCapabilities';
import { DeploymentProfileConflict, parseDeploymentProfile, type SavedDeploymentProfile } from './deploymentProfilesCore';

const profile = {
	id: 'hobby-test',
	mode: 'parallel' as const,
	label: 'Hobby test',
	teamId: 'team_abc',
	teamSlug: 'thingtime',
	projectId: 'prj_abc',
	projectName: 'thingtime',
	enabled: false,
	testOrigin: 'https://thingtime-test.vercel.app'
};
const saved = { ...profile, revision: 'revision' };
const url = 'https://thingtime.test/api/v1/admin/ci/deployment-profiles';
test('profiles restrict primary authority and Vercel origins, and project only metadata', () => {
	assert.deepEqual(parseDeploymentProfile({ ...profile, token: 'synthetic' }), profile);
	for (const extra of [
		{ id: 'legacy' },
		{ mode: 'primary' },
		{ id: '../hobby' },
		{ enabled: 'true' },
		{ teamId: '' },
		{ projectId: '' },
		{ testOrigin: 'https://example.org' },
		{ testOrigin: 'https://example.vercel.app@attacker.com' },
		{ testOrigin: 'https://example.vercel.app/path' }
	]) {
		assert.throws(() => parseDeploymentProfile({ ...profile, ...extra }), TypeError);
	}
	assert.doesNotThrow(() => parseDeploymentProfile({ ...profile, id: 'legacy', mode: 'primary', testOrigin: '' }));
	assert.deepEqual(parseDeploymentProfile({ ...profile, pilotLanes: ['production', 'preview'] }).pilotLanes, ['production', 'preview']);
	for (const pilotLanes of [['production', 'production'], ['staging'], 'production'])
		assert.throws(() => parseDeploymentProfile({ ...profile, pilotLanes }), TypeError);
	assert.throws(() => parseDeploymentProfile({ ...profile, id: 'legacy', mode: 'primary', testOrigin: '', pilotLanes: ['production'] }), TypeError);
});
test('admin policy requires live admin, JSON, actor, expected revision; conflicts keep existing state', async () => {
	let writes = 0;
	const options = {
		get: async () => [saved],
		set: async (data: unknown, expected: string | null) => {
			if (expected !== saved.revision) throw new DeploymentProfileConflict();
			writes++;
			return { ...parseDeploymentProfile(data), revision: 'next' };
		}
	};
	const request = (headers: Record<string, string>, body: unknown) => new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
	const body = { profile: { ...profile, enabled: true }, expectedRevision: saved.revision };
	const headers = { 'content-type': 'application/json', 'x-thingtime-expected-actor': 'admin' };
	const denied = createDeploymentProfileHandlers({ ...options, requireAdmin: async () => ({ error: { status: 403, message: 'Forbidden' } }) });
	assert.equal((await denied.action({ request: request(headers, body) })).status, 403);
	const admin = createDeploymentProfileHandlers({ ...options, requireAdmin: async () => ({ user: { id: 'admin' } } as any) });
	assert.deepEqual((await (await admin.loader({ request: new Request(url) })).json()).profiles, [saved]);
	for (const [h, b, status] of [
		[{ ...headers, 'content-type': 'text/plain' }, body, 415],
		[{ ...headers, 'x-thingtime-expected-actor': 'different' }, body, 409],
		[headers, { profile }, 400],
		[headers, { ...body, expectedRevision: 'old' }, 409]
	] as const) {
		assert.equal((await admin.action({ request: request(h, b) })).status, status);
	}
	assert.equal(writes, 0);
	const response = await admin.action({ request: request(headers, body) });
	assert.equal(response.status, 200);
	assert.equal((await response.json()).profile.enabled, true);
	assert.equal(writes, 1);
	assert.match(response.headers.get('cache-control')!, /private.*no-store/);
});
test('controller enforces separate signed purpose, configured repository, clock and protected ref, strips revisions', async () => {
	const secret = 'synthetic',
		repository = 'lopugit/thingtime';
	let reads = 0;
	const handler = createControllerDeploymentProfilesHandler({
		get: async (): Promise<SavedDeploymentProfile[]> => {
			reads++;
			return [saved];
		},
		repository: () => repository,
		secret: () => secret
	});
	const body = { purpose: 'deployment-profiles', repository, ref: 'github-actions', requestedAt: new Date().toISOString() };
	const call = async (patch: Record<string, unknown>, signer = secret) => {
		const raw = JSON.stringify({ ...body, ...patch });
		return handler({
			request: new Request(url, {
				method: 'POST',
				body: raw,
				headers: { 'x-thingtime-ci-signature': 'sha256=' + createHmac('sha256', signer).update(raw).digest('hex') }
			})
		});
	};
	assert.equal((await call({}, 'wrong')).status, 403);
	for (const patch of [{ purpose: 'something-else' }, { requestedAt: '2000-01-01T00:00:00.000Z' }, { ref: 'main' }, { repository: 'other/repo' }])
		assert.equal((await call(patch)).status, 400);
	assert.equal(reads, 0);
	assert.deepEqual(await (await call({})).json(), { ok: true, repository, profiles: [profile] });
});
test('deployment profile routes are represented by both capability manifests', () => {
	for (const [id, route] of [
		['admin-ci-deployment-profiles', 'admin'],
		['integration-ci-deployment-profiles', 'integrations']
	]) {
		const feature = 'api.' + id,
			manifest = thingtimeCapabilityManifest('https://thingtime.test');
		assert.equal(manifest.features[feature].version, '1.1.0');
		assert.equal(createApiCapabilitiesManifest().features[feature], '1.1.0');
		assert.ok(manifest.operations.some((op) => op.feature === feature && op.path === '/api/v1/' + route + '/ci/deployment-profiles'));
	}
});
