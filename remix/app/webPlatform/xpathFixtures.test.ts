import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { xpathRecipe } from './xpathFixtures';
import { XPATH_BOUNDARIES } from './xpathBoundaryFixtures';
import { editXPathProgram } from './xpathTestCases';
import { xpathExpression, xpathResolver, xpathCost } from './xpathSupport';
import { compilePlatformWorker } from './workerSource';

test('XPath catalogue entries serialize as editable reusable programs', () => {
	const features = WEB_FEATURES.filter((f) => (f.interface || f.name).startsWith('XPath'));
	assert.equal(features.length, 30);
	for (const f of features) {
		const program = xpathRecipe(f)!.program;
		assert.equal(featureCoverage(f), 'interactive');
		const component = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		assert.deepEqual(component.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program, program);
		const edited = editXPathProgram(program);
		assert.notDeepEqual(program.parameters, edited.parameters);
		for (const p of [program, edited]) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(p)), f.name);
	}
	for (const f of XPATH_BOUNDARIES) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(f.program)), f.name);
});
test('XPath native work boundaries account for syntax, tree size and text', () => {
	for (const value of [
		'.//li',
		"count(.//li[@data-kind='veg'])",
		'string(.//li[2])',
		'//x:li',
		"//li[@title='//[x]']",
		"//li[@title='\n//[x]']",
		'//*['
	])
		assert.equal(xpathExpression(value).text, value);
	for (const value of [
		'//li[.//li]',
		'//*[ancestor::li]',
		'//*[li[li]]',
		'('.repeat(9) + '1' + ')'.repeat(9),
		'1+'.repeat(40) + '1',
		'x'.repeat(513)
	])
		assert.throws(() => xpathExpression(value));
	assert.ok(xpathCost(8, 30, 100, 20) > 0);
	assert.throws(() => xpathCost(8, 129, 100, 20), /tree budget/);
	assert.throws(() => xpathCost(8, 30, 1025, 20), /tree budget/);
	assert.throws(() => xpathCost(64, 128, 1024, 512), /work budget/);
});
test('XPath namespace callback values are data-backed, bounded and prototype-independent', () => {
	const source = { x: 'http://www.w3.org/1999/xhtml' };
	const resolver = xpathResolver(source);
	source.x = 'changed';
	assert.equal(resolver.lookupNamespaceURI('x'), 'http://www.w3.org/1999/xhtml');
	assert.equal(resolver.lookupNamespaceURI('toString'), null);
	assert.equal(resolver.lookupNamespaceURI(null), null);
	for (const value of [
		{ x: 1 },
		{ x: 'a'.repeat(513) },
		{ $callback: 1 },
		[],
		Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['p' + i, 'urn:test']))
	])
		assert.throws(() => xpathResolver(value));
});
