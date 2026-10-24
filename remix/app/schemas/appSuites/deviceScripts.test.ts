import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeSuite } from '../behaviourSuites';
import { macMenuBarSuite } from './macMenuBar';
import { deviceScriptsSuite } from './deviceScripts';
import { executeBrowserAction, type BrowserActionHost } from '../../components/Actions/browserActionRuntime';
import { sanitizeActionCrystal, sanitizeExtended, validateThingtimeCrystal } from '../registry';
import { validateRunInputs } from '../../api/utils/actions/actionInputs';
const parts = materializeSuite(deviceScriptsSuite, 'own');
const run = (key: string, inputs: Record<string, unknown>, request: BrowserActionHost['request']) =>
	executeBrowserAction(
		{
			ok: true,
			status: 'prepared',
			execution: 'browser',
			actionId: key,
			viewer: { id: 'fixture' },
			inputs: (() => {
				const checked = validateRunInputs(parts.actions.find((a) => a.key === key)!.crystal.inputs as Record<string, unknown>[], inputs);
				assert.equal(checked.ok, true);
				if (!checked.ok) throw Error(checked.error);
				return checked.inputs;
			})(),
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
	const script = '$input.secret\n#' + 'x'.repeat(16384 - '$input.secret\n#'.length);
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
	const prepared = validateRunInputs(checked.crystal.inputs as Record<string, unknown>[], { deviceId: 'mac', requestId: 'run-1' });
	assert.equal(prepared.ok, true);
	if (!prepared.ok) throw Error(prepared.error);
	let submitted: any;
	await executeBrowserAction(
		{
			ok: true,
			status: 'prepared',
			execution: 'browser',
			actionId: 'saved',
			viewer: { id: 'fixture' },
			inputs: prepared.inputs,
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
	const result = { stdout: '\ufffd'.repeat(16384), stderr: '', exitCode: 0, signal: null, timedOut: false, truncated: false };
	await run('save-result', { deviceId: 'mac', commandId: 'job' }, async (step) => {
		if (step.method === 'GET') {
			assert.deepEqual(step.query, { deviceId: 'mac', commandId: 'job' });
			return { command: { kind: 'script.run', status: 'succeeded', result } };
		}
		saved = step.body;
		return { thing: { id: 'saved' } };
	});
	assert.deepEqual(saved.acl, ['tt:user']);
	assert.equal(validateThingtimeCrystal(saved.thingtime, saved.crystal).ok, true);
	assert.equal(sanitizeExtended(saved.extended).ok, true);
	assert.deepEqual(saved.extended.result, result);
	assert.equal(saved.crystal.exitCode, 0);
	assert.equal(saved.crystal.result, undefined);
});
