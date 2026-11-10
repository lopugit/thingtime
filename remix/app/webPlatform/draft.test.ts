import assert from 'node:assert/strict';
import test from 'node:test';
import { platformFieldValue, reconcilePlatformInputs, snapshotPlatformDraft } from './draft';
import type { PlatformProgram } from './types';
import { resolveTemplate, MAX_RESOLVED_CHARS } from '../components/ComponentsLibrary/componentTemplate';
import { materializeSuite } from '../schemas/behaviourSuites';
import { webStandardsSuite } from '../schemas/appSuites/webStandards';
import { executeBrowserAction } from '../components/Actions/browserActionRuntime';
import { validateRunInputs } from '../api/utils/actions/actionInputs';
import { validateThingtimeCrystal } from '../schemas/registry';

const program: PlatformProgram = {
	version: 1, title: 'My editable program',
	parameters: [
		{ name: 'count', label: 'Count', type: 'number', default: 3 },
		{ name: 'enabled', label: 'Enabled', type: 'boolean', default: true },
		{ name: 'text', label: 'Text', type: 'text', default: 'original' },
		{ name: 'data', label: 'Data', type: 'json', default: [1, 2] }
	],
	steps: [{ op: 'return', value: { op: 'input', name: 'data' } }]
};

test('the same draft snapshot runs and saves edited definitions and exact falsy defaults', () => {
	const edited = { ...program, title: 'Changed title', steps: [{ op: 'return', value: { op: 'literal', value: '$input.keepThisLiteral' } }] };
	const result = snapshotPlatformDraft(JSON.stringify(edited), {
		count: { type: 'number', value: '0' }, enabled: { type: 'boolean', value: false }, text: { type: 'text', value: '' }, data: { type: 'json', value: 'null' }
	});
	assert.deepEqual(result.input, { count: 0, enabled: false, text: '', data: null });
	assert.equal(result.program.title, edited.title);
	assert.deepEqual(result.program.steps, edited.steps);
	assert.deepEqual(result.program.parameters!.map(p => p.default), [0, false, '', null]);
	assert.deepEqual(snapshotPlatformDraft(JSON.stringify(result.program)).input, result.input);
	assert.equal(program.parameters![0].default, 3);
});

test('changed defaults and parameter types become current while removed overrides are discarded', () => {
	const edited: PlatformProgram = { ...program, parameters: [{ name: 'count', label: 'Count text', type: 'text', default: 'new default' }] };
	const prior = { count: { type: 'number' as const, value: '42' }, removed: { type: 'text' as const, value: 'old' } };
	assert.deepEqual(reconcilePlatformInputs(edited, prior), {});
	assert.equal(platformFieldValue(edited.parameters![0], prior), 'new default');
	assert.deepEqual(snapshotPlatformDraft(JSON.stringify(edited), prior).input, { count: 'new default' });
	const changedDefaults = { ...program, parameters: program.parameters!.map(p => p.name === 'count' ? { ...p, default: 19 } : p) };
	assert.equal(snapshotPlatformDraft(JSON.stringify(changedDefaults)).input.count, 19);
});

test('malformed or oversized drafts cannot fall back to the previous valid definition', () => {
	assert.throws(() => snapshotPlatformDraft('{'));
	assert.throws(() => snapshotPlatformDraft(JSON.stringify({ ...program, steps: [{ op: 'source', code: 'alert(1)' }] })));
	for (const value of ['', 'NaN', 'Infinity']) assert.throws(() => snapshotPlatformDraft(JSON.stringify(program), { count: { type: 'number', value } }));
	assert.throws(() => snapshotPlatformDraft(JSON.stringify(program), { data: { type: 'json', value: '{' } }));
	assert.throws(() => snapshotPlatformDraft(JSON.stringify(program), { text: { type: 'text', value: 'x'.repeat(17000) } }));
});

test('saved and bound programs preserve nested arrays, token text and template-shaped JSON as inert data', () => {
	const value = { ...program, steps: [{ op: 'return', value: { op: 'literal', value: { text: '{name} {query.q}', nested: [[0, null], [false, '']], ttArg: 'secret', ttIf: { arg: 'secret' } } } }] };
	const scope = { name: 'must not replace', query: { q: 'must not replace' }, secret: 'must not disclose', result: { program: value } };
	for (const binding of [value, { ttArg: 'result.program' }]) for (const tag of ['tt-web-platform', 'TT-WEB-PLATFORM']) {
		const result: any = resolveTemplate({ tag, props: { program: binding, name: '{name}' } }, scope);
		assert.deepEqual(result.props.program, value);
		assert.equal(result.props.name, 'must not replace', 'ordinary surrounding bindings still resolve');
	}
	const excessive: any = resolveTemplate({ tag: 'tt-web-platform', props: { program: { version: 1, title: 'x', document: ['x'.repeat(MAX_RESOLVED_CHARS + 1)] } } });
	assert.equal(excessive?.props?.program, undefined, 'exhausted data programs are omitted whole rather than truncated into another program');
});

test('the authored save Action posts the exact current program through the generic browser runtime', async () => {
	const definition = JSON.stringify({ ...program, title: 'Saved draft', steps: [{ op: 'return', value: { op: 'literal', value: '{name} $input.program' } }] });
	const { program: saved } = snapshotPlatformDraft(definition, { count: { type: 'number', value: '0' } });
	const action = materializeSuite(webStandardsSuite, 'own').actions.find(a => a.key === 'save-draft')!.crystal;
	const validated = validateRunInputs(action.inputs as Record<string, unknown>[], { program: saved });
	assert.ok(validated.ok);
	if (!validated.ok) return;
	const requests: any[] = [];
	const result = await executeBrowserAction({ ok: true, status: 'prepared', execution: 'browser', actionId: 'save-draft', viewer: { id: 'owner' }, program: action, inputs: validated.inputs }, {
		assertIdentity: id => assert.equal(id, 'owner'),
		prepare: async () => { throw new Error('No child preparation is needed'); },
		request: async step => {
			requests.push(step);
			const body = step.body as any;
			assert.deepEqual(body.acl, ['tt:user']);
			assert.equal(validateThingtimeCrystal(['component'], body.crystal).ok, true);
			assert.deepEqual(body.crystal.render.props.program, saved);
			assert.deepEqual((resolveTemplate(body.crystal.render, { name: 'not program data' }) as any).props.program, saved);
			return { ok: true, thing: { id: 'saved-component', crystal: body.crystal } };
		}
	});
	assert.equal(requests.length, 1);
	assert.equal(requests[0].path, '/api/v1/things');
	assert.deepEqual(result, { id: 'saved-component', name: 'Saved draft', silent: true });
});
