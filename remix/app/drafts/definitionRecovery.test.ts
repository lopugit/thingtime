import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createWithDraft } from './createWithDraft';
import { restoreDefinitionDraft } from '../components/Builder/DefinitionEditor/definitionDraft';

const text = readFileSync(new URL('../components/Builder/DefinitionEditor/ThingDefinitionEditor.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('ThingDefinitionEditor.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions = new Map<string, string>();
function visit(node: ts.Node) {
	if (ts.isVariableDeclaration(node) && node.initializer) expressions.set(node.name.getText(source), node.initializer.getText(source));
	if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'onRestore') expressions.set('onRestore', node.initializer.getText(source));
	ts.forEachChild(node, visit);
}
visit(source);
const evaluate = (name: string, context: Record<string, unknown>) => {
	assert.ok(expressions.has(name));
	return runInNewContext(ts.transpileModule(`(${expressions.get(name)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
};

test('definition recovery retains its original server version, including unfinished JSON', () => {
	let draftBase: string | null = null, restoredSource = '';
	const restored = { current: false };
	evaluate('onRestore', {
		restoreDefinitionDraft, setMode() {}, setFields() {}, setDirty() {}, restored, setDraftBase: (value: string | null) => { draftBase = value; }, setSource: (value: string) => { restoredSource = value; }
	})({ snapshot: JSON.stringify({ source: '{"unfinished":', baseUpdatedAt: 'old-version' }) });
	assert.equal(draftBase, 'old-version');
	assert.equal(restoredSource, '{"unfinished":');
	assert.equal(evaluate('staleDraft', { restored, draftBase, thing: { updatedAt: 'new-version' } }), true);
	assert.equal(evaluate('staleDraft', { restored, draftBase, thing: { updatedAt: 'old-version' } }), false);
	assert.equal(evaluate('staleDraft', { restored, draftBase: null, thing: { updatedAt: 'new-version' } }), true, 'Legacy drafts cannot silently borrow a fresh write version');
});

test('a stale recovered definition never flushes or publishes over newer content', async () => {
	await evaluate('save', { pending: { current: false }, thing: {}, parsed: {}, parseError: '', staleDraft: true })();
});

test('a server conflict preserves both account and Timeline drafts', async () => {
	let submitted: any, error = '', cleared = false, released = false;
	await evaluate('save', {
        localOnly: false,
		pending: { current: false }, active: { current: true }, thing: { thingtime: ['component'], updatedAt: 'new-version' },
		createWithDraft, invalidNumbers: false, parsed: { name: 'Recovered' }, parseError: '', staleDraft: false, draftBase: 'old-version', id: 'component-id', actor: 'owner-id',
		validateThingtimeCrystal: () => ({ ok: true }), setSaving: () => {}, setError: (value: string) => { error = value; },
		accountDraft: { flush: async () => {}, retire: async () => { cleared = true; } },
		draft: { flush: async () => 'event-id', release: async () => { released = true; } },
		apiRef: { current: { v1: { things: { update: async (input: any) => { submitted = input; return { ok: false, error: 'Version conflict' }; } } } } }
	})();
	assert.equal(submitted.expectedUpdatedAt, 'old-version');
	assert.equal(error, 'Version conflict');
	assert.equal(cleared, false);
	assert.equal(released, false);
});

test('explicitly discarding a recovered definition selects the latest without waiting for History or draft cleanup', async () => {
 let retired = false, selected = '', base = '';
 evaluate('selectSavedVersion', {
  localOnly: false, pending: { current: false }, thing: { crystal: { name: 'Latest' }, updatedAt: 'latest', thingtime: ['component'] },
  source: 'Recovered text', sourceSnapshot: (source: string) => ({ source }), setError() {},
  restored: { current: true }, edited: { current: true }, setDraftBase(value: string) { base=value; }, setSource(value: string) { selected=value; }, setFields() {}, setDirty() {},
  draft: { record: () => new Promise(() => {}) }, accountDraft: { retire: () => { retired=true; return new Promise(() => {}); } }
 })();
 assert.equal(retired, true); assert.equal(base, 'latest'); assert.equal(JSON.parse(selected).name, 'Latest');
});

test('local definition saves retain conditional writes and local drafts without requiring account Timeline', async () => {
 let submitted: any, cleared = false, saved = false, closed = false, error = '';
 const history = () => { throw new Error('Account Timeline must not be used by anonymous editor'); };
 await evaluate('save', {
  localOnly: true, pending: { current: false }, active: { current: true }, thing: { thingtime: ['action'], updatedAt: 'old' },
  createWithDraft, invalidNumbers: false, parsed: { name: 'Offline', steps: [{ op: 'return', value: true }] }, parseError: '', staleDraft: false, draftBase: 'old', id: 'local-action', actor: 'local-workspace',
  validateThingtimeCrystal: () => ({ ok: true }), setSaving() {}, setError(value: string) { error = value; },
  accountDraft: { flush: async () => {}, retire: async () => { cleared = true; } }, draft: { flush: history, release: history },
  apiRef: { current: { v1: { things: { update: async (input: unknown) => { submitted = input; return { ok: true }; }, get: async () => ({ ok: true, thing: { id: 'local-action' } }) } } } },
  onSaved: () => { saved = true; }, onClose: () => { closed = true; }
 })();
 assert.equal(error,''); assert.equal(submitted.expectedUpdatedAt,'old'); assert.equal(submitted.replaceCrystal,true);
 assert.equal(cleared,true); assert.equal(saved,true); assert.equal(closed,true);
});
