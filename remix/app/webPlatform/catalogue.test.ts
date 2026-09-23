import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { WEB_FEATURES, browseStandards, componentForFeature } from './catalogue';
import { featureRecipe } from './recipes';
import { compilePlatformProgram } from './compiler';
import { materializeSuite } from '../schemas/behaviourSuites';
import { webStandardsSuite } from '../schemas/appSuites/webStandards';
import { validateThingtimeCrystal } from '../schemas/registry';
import { resolveTemplate } from '../components/ComponentsLibrary/componentTemplate';
const feature = (language: string, name: string) => WEB_FEATURES.find((f) => f.language === language && f.name === name)!;

test('published inventories have stable unique identities, authoritative links and explicit provenance', () => {
	assert.ok(WEB_FEATURES.length > 18000);
	assert.equal(new Set(WEB_FEATURES.map((f) => f.id)).size, WEB_FEATURES.length);
	for (const f of WEB_FEATURES) {
		assert.ok(/^https:\/\//.test(f.spec), f.id);
		assert.ok(f.status, f.id);
		assert.ok(f.references.includes(f.spec));
	}
	for (const name of ['dialog', 'select', 'search', 'slot']) assert.ok(feature('html', name));
	for (const name of ['contenteditable', 'popover', 'hidden', 'onbeforeinput']) assert.ok(feature('html', name));
	for (const name of ['display', '@layer', ':has()', 'color-mix()']) assert.ok(feature('css', name), name);
	assert.ok(WEB_FEATURES.some((f) => f.name.startsWith('Array.prototype.toSorted')));
	assert.ok(feature('webapi', 'AbortController.abort'));
});
test('every example is serializable, compilable, and exportable through the real Component write gate', () => {
	for (const f of WEB_FEATURES) {
		const program = featureRecipe(f).program;
		assert.doesNotThrow(() => compilePlatformProgram(program), f.id);
		const checked = validateThingtimeCrystal(['component'], componentForFeature(f.id));
		assert.ok(checked.ok, `${f.name}: ${checked.ok === false ? checked.error : ''}`);
	}
});
test('the suite consists entirely of valid reusable Things and live program bindings', () => {
	for (const mode of ['own', 'system'] as const) {
		const bundle = materializeSuite(webStandardsSuite, mode);
		for (const [kind, entries] of Object.entries({ component: bundle.components, action: bundle.actions, webpage: bundle.pages }))
			for (const entry of entries) {
				const checked = validateThingtimeCrystal([kind], entry.crystal);
				assert.ok(checked.ok, `${kind} ${entry.key}: ${checked.ok === false ? checked.error : ''}`);
			}
		assert.ok(!JSON.stringify(bundle.pages).includes('"native"'));
		assert.equal(bundle.actions.find((a) => a.key === 'save-component')?.crystal.runtime, 'browser');
	}
	const bundle = materializeSuite(webStandardsSuite, 'own');
	const result = browseStandards({ feature: feature('html', 'dialog').id });
	const tree = resolveTemplate(bundle.components.find((c) => c.key === 'workbench')!.crystal.render, { result });
	assert.ok(JSON.stringify(tree).includes('tt-web-platform'));
	assert.ok(JSON.stringify(tree).includes('showModal'));
});
test('search bounds input, preserves filters and never calls an inspection a completed demo', () => {
	const result = browseStandards({ language: 'css', q: 'grid', coverage: 'interactive', page: 999999 });
	assert.ok(result.cards.length <= 18);
	assert.equal(result.page, result.pages);
	assert.ok(result.cards.every((c) => c.language === 'css' && c.coverage === 'interactive'));
	assert.ok(result.previous.includes('q=grid'));
	assert.equal(browseStandards({ q: 'no-such-feature-zz' }).matched, 0);
	const inspection = browseStandards({ feature: feature('webapi', 'Geolocation').id });
	assert.equal(inspection.selected?.coverage, 'requires-context');
	assert.throws(() => componentForFeature('__proto__'));
});
test('declarative JS returns real built-in results and rejects source escapes', async () => {
	for (const [name, expected] of [
		['Array.prototype.at ( index )', 1],
		['Math.sqrt ( x )', 4]
	] as const) {
		const f = feature('javascript', name);
		assert.ok(f, name);
		const p = featureRecipe(f).program;
		const input = Object.fromEntries(p.parameters!.map((p) => [p.name, p.default]));
		const result = await vm.runInNewContext(`(async()=>{${compilePlatformProgram(p)}})()`, { input }, { timeout: 250 });
		assert.equal(result, expected);
	}
	assert.throws(() =>
		compilePlatformProgram({ version: 1, title: 'bad', steps: [{ op: 'return', value: { op: 'source', code: 'fetch("/api/v1/things")' } }] })
	);
	assert.throws(() =>
		compilePlatformProgram({ version: 1, title: 'bad', steps: [{ op: 'return', value: { op: 'global', name: 'a);alert(1)//' } }] })
	);
	const deeply: any = { op: 'unary', operator: '!', value: 1 };
	for (let i = 0; i < 35; i++) deeply.value = { ...deeply };
	assert.throws(() => compilePlatformProgram({ version: 1, title: 'deep', steps: [{ op: 'return', value: deeply }] }));
});
test('dynamic-code property keys are refused however they are spelled', () => {
	// A literal node and a one-element array read the same property as the bare
	// string, so the check cannot compare the authored spelling alone.
	const arrow = { op: 'function', params: ['x'], value: { op: 'variable', name: 'x' } };
	const compileBody = (value: unknown) => ({ version: 1 as const, title: 'key', steps: [{ op: 'return', value }] });
	const compile = (value: unknown) => () => compilePlatformProgram(compileBody(value));
	for (const name of ['constructor', '__proto__', 'eval'])
		for (const key of [name, { op: 'literal', value: name }, [name], { op: 'literal', value: [name] }]) {
			assert.throws(compile({ op: 'get', target: arrow, key }), /Dynamic code constructors/, `get ${name} ${JSON.stringify(key)}`);
			assert.throws(compile({ op: 'method', target: arrow, key: name, args: [] }), /Dynamic code constructors/, `method ${name}`);
		}
	// Reaching Function through .constructor is the concrete escape this blocks.
	assert.throws(
		compile({ op: 'call', target: { op: 'get', target: arrow, key: { op: 'literal', value: 'constructor' } }, args: [{ op: 'literal', value: 'return 1' }] }),
		/Dynamic code constructors/
	);
	// Ordinary property reads, prototype lookups and computed indexing still compile.
	assert.match(compilePlatformProgram(compileBody({ op: 'get', target: { op: 'global', name: 'Array' }, key: 'prototype' })), /\["prototype"\]/);
	assert.match(compilePlatformProgram(compileBody({ op: 'get', target: { op: 'variable', name: 'a' }, key: { op: 'variable', name: 'i' } })), /\(a\)\[i\]/);
	assert.match(compilePlatformProgram(compileBody({ op: 'get', target: arrow, key: 'name' })), /\["name"\]/);
});
test('malformed parameter descriptors cannot reach the React surface', () => {
	for (const parameters of [{ name: 'x' }, [{ name: 'x', label: {}, type: 'text' }], Array(2).fill({ name: 'x', label: 'X', type: 'text' })]) {
		assert.throws(() => compilePlatformProgram({ version: 1, title: 'Invalid', parameters }));
	}
});

test('isolated runtime cannot inherit account authority, network origins, eval or executable HTML', () => {
	const csp = readFileSync(new URL('../../scripts/csp.mjs', import.meta.url), 'utf8').split('export const platformRuntimeCsp =')[1];
	assert.ok(csp.includes("sandbox: ['allow-scripts']"));
	assert.ok(!csp.includes('allow-same-origin'));
	assert.ok(!csp.includes('unsafe-eval'));
	assert.ok(!csp.includes('https:'));
	const runtime = readFileSync(new URL('./runtimeEntry.ts', import.meta.url), 'utf8');
	assert.ok(runtime.includes('worker.terminate()'));
	assert.ok(/event\.source\s*!==\s*parent/.test(runtime));
	assert.ok(/'script',\s*'iframe'/.test(runtime));
});
