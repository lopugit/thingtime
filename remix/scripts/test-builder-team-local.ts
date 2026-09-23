// Explicit opt-in local acceptance: saved foreign flows, private copies and
// current membership checks. Synthetic records stay in the disposable QA root.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { executeBrowserAction } from '../app/components/Actions/browserActionRuntime';

async function main() {
	const origin = process.env.TT_BUILDER_QA_ORIGIN || '';
	const url = new URL(origin);
	assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash, 'Use an explicit loopback QA origin');
	assert.ok(process.env.TT_BUILDER_QA_SESSION && process.env.TT_BUILDER_QA_TEAM_SESSION, 'Set private owner and team fixture session paths');
	const owner = JSON.parse(await readFile(process.env.TT_BUILDER_QA_SESSION!, 'utf8'));
	const request = async (session: any, path: string, body?: any) => {
		const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { cookie: session?.cookie || '', origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
		return { response, data: await response.json() as any };
	};
	const call = async (session: any, path: string, body?: any) => {
		const { response, data } = await request(session, path, body);
		assert.ok(response.ok && data.ok !== false, `${path.split('?')[0]}: ${response.status} ${data.error || ''}`);
		return data;
	};
	let team: any;
	try { team = JSON.parse(await readFile(process.env.TT_BUILDER_QA_TEAM_SESSION!, 'utf8')); }
	catch {
		const username = `builder-team-${randomUUID().slice(0, 8)}`;
		const password = 'Builder-local-team-2026!';
		const { response, data } = await request(null, '/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
		assert.ok(response.ok && data.user?.id, `Local signup: ${data.error || response.status}`);
		team = { user: data.user, password, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
		await writeFile(process.env.TT_BUILDER_QA_TEAM_SESSION!, JSON.stringify(team), { mode: 0o600 });
	}
	const rootId = 'qa-editable-builder-root', pageId = 'qa-editable-builder-page';
	const workspace = (session: any) => call(session, '/api/v1/builder/workspaces?rootId=' + rootId);
	let previous = (await workspace(owner)).records.find((record: any) => record.kind === 'member' && record.values.userId === team.user.id);
	if (previous?.values.archived) {
		await call(owner, '/api/v1/builder/workspaces', { operation: 'archive', rootId, id: previous.id, archived: false, expectedUpdatedAt: previous.updatedAt });
		previous = (await workspace(owner)).records.find((record: any) => record.id === previous.id);
	}
	await call(owner, '/api/v1/builder/workspaces', { operation: 'save', rootId, id: previous?.id || randomUUID(), kind: 'member', values: { username: team.user.username, role: 'Employee' }, ...(previous ? { expectedUpdatedAt: previous.updatedAt } : {}) });
	await call(owner, '/api/v1/builder/workspaces', { operation: 'bindPage', rootId, pageId });
	assert.equal((await workspace(team)).role, 'Employee');
	assert.equal((await call(team, '/api/v1/things?id=' + pageId)).thing.id, pageId);
	const foreign = await request(team, '/api/v1/actions/run', { action: 'qa-editable-app-read', inputs: { rootId }, source: 'component', execution: 'browser', executionVersion: '1.9.0' });
	assert.equal(foreign.data.ok, false, 'Foreign Actions never inherit the viewer authority');
	const shared = await request(team, '/api/v1/actions/run', { action: 'qa-editable-app-read', inputs: { rootId }, sharedRoot: pageId });
	assert.equal(shared.response.status, 403, 'Shared browser Actions require an explicit owned copy');
	const copied = await call(team, '/api/v1/things/fork', { id: pageId });
	assert.equal(copied.copied, 50);
	const page = (await call(team, '/api/v1/things?id=' + copied.id)).thing;
	assert.deepEqual(page.acl, ['tt:user']);
	assert.equal(page.author.id, team.user.id);
	const navigation = (await call(team, '/api/v1/things?id=' + page.crystal.blocks[0].children[0].component)).thing;
	const prepare = (action: string, inputs: any) => call(team, '/api/v1/actions/run', { action, inputs, source: 'component', execution: 'browser', executionVersion: '1.9.0' });
	const host = {
		assertIdentity: (id: string) => assert.equal(id, team.user.id),
		request: (step: any) => call(team, step.path + (Object.keys(step.query).length ? '?' + new URLSearchParams(step.query) : ''), step.method === 'GET' ? undefined : step.body),
		prepare
	};
	async function read() {
		return executeBrowserAction(await prepare(navigation.crystal.source.action, { rootId, view: 'customer' }), host) as any;
	}
	const authorized: any = await read();
	assert.equal(authorized.role, 'Employee');
	assert.ok(authorized.records.some((r: any) => r.id === 'qa-builder-customer'));
	const member = (await workspace(owner)).records.find((record: any) => record.kind === 'member' && record.values.userId === team.user.id);
	await call(owner, '/api/v1/builder/workspaces', { operation: 'archive', rootId, id: member.id, expectedUpdatedAt: member.updatedAt });
	assert.equal((await request(team, '/api/v1/things?id=' + pageId)).response.status, 404);
	assert.equal((await request(team, '/api/v1/things/fork', { id: pageId })).response.status, 404);
	assert.equal((await request(team, '/api/v1/builder/workspaces', { operation: 'save', rootId, id: 'qa-builder-customer', kind: 'customer', values: { firstName: 'Must not save' } })).response.status, 404);
	await assert.rejects(read(), /404 Workspace not found or access has been revoked/);
	// Restore only this synthetic member for the following Chrome acceptance.
	const archived = (await workspace(owner)).records.find((record: any) => record.id === member.id);
	await call(owner, '/api/v1/builder/workspaces', { operation: 'archive', rootId, id: member.id, archived: false, expectedUpdatedAt: archived.updatedAt });
	assert.equal((await workspace(team)).role, 'Employee');
	console.log({ username: team.user.username, copiedPage: origin + '/p/' + copied.id, copied: copied.copied, foreignRunDenied: true, revokedReadDenied: true, membershipRestored: true });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
