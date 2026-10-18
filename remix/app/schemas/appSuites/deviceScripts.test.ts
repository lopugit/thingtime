import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeSuite } from '../behaviourSuites';
import { deviceScriptsSuite } from './deviceScripts';
import { executeBrowserAction, type BrowserActionHost } from '../../components/Actions/browserActionRuntime';
import { sanitizeActionCrystal } from '../registry';
const parts = materializeSuite(deviceScriptsSuite, 'own');
const run = (key: string, inputs: Record<string, unknown>, request: BrowserActionHost['request']) =>
	executeBrowserAction(
		{
			ok: true,
			status: 'prepared',
			execution: 'browser',
			actionId: key,
			viewer: { id: 'fixture' },
			inputs,
			program: parts.actions.find((a) => a.key === key)!.crystal
		},
		{
			assertIdentity: (id) => assert.equal(id, 'fixture'),
			request,
			prepare: async () => {
				throw Error('Unexpected child');
			}
		}
	);
test('saved recipes preserve Bash literally and defer device/run inputs until execution', async () => {
	const script = "printf '%s' '$input.secret $(not executed by the builder)'";
	let saved: any;
	await run('save-recipe', { script, recipeName: 'My recipe', timeoutSeconds: 3 }, async (step) => {
		saved = step.body;
		return { thing: { id: 'saved' } };
	});
	assert.deepEqual(saved.acl, ['tt:user']);
	assert.equal(saved.thingtime[0], 'action');
	const checked = sanitizeActionCrystal(saved.crystal);
	assert.equal(checked.ok, true);
	if (!checked.ok) throw Error('Invalid saved recipe');
	let submitted: any;
	await executeBrowserAction(
		{
			ok: true,
			status: 'prepared',
			execution: 'browser',
			actionId: 'saved',
			viewer: { id: 'fixture' },
			inputs: { deviceId: 'mac', requestId: 'run-1' },
			program: checked.crystal
		},
		{
			assertIdentity: () => {},
			request: async (step) => {
				submitted = step.body;
				return { command: { id: 'job', status: 'needs-approval' } };
			},
			prepare: async () => {
				throw Error('Unexpected child');
			}
		}
	);
	assert.deepEqual(submitted, { deviceId: 'mac', requestId: 'run-1', kind: 'script.run', input: { script, timeoutSeconds: 3 } });
});
test('saving a result re-reads the exact owner command and refuses pending/expired results', async () => {
	let writes = 0;
	await assert.rejects(
		run('save-result', { deviceId: 'mac', commandId: 'job' }, async (step) => {
			if (step.method === 'POST') writes++;
			return { command: { kind: 'script.run', status: 'running' } };
		}),
		/No completed/
	);
	assert.equal(writes, 0);
	let saved: any;
	const result = { stdout: 'ok', stderr: '', exitCode: 0, signal: null, timedOut: false, truncated: false };
	await run('save-result', { deviceId: 'mac', commandId: 'job' }, async (step) => {
		if (step.method === 'GET') {
			assert.deepEqual(step.query, { deviceId: 'mac', commandId: 'job' });
			return { command: { kind: 'script.run', status: 'succeeded', result } };
		}
		saved = step.body;
		return { thing: { id: 'saved' } };
	});
	assert.deepEqual(saved.acl, ['tt:user']);
	assert.deepEqual(saved.crystal.result, result);
});
