import assert from 'node:assert/strict';
import test from 'node:test';
import type { LibraryExample } from './types';
import { exampleThings } from './reuse';
import { validateThingtimeCrystal } from '../schemas/registry';
import { buildExampleRequest, parseExampleInput, readBoundedJson } from './request';
import { exampleSandbox } from './sandbox';
import { thingtimeCapabilityManifest, capabilitySatisfies } from '../api/utils/capabilities/thingtimeCapabilities';
import { readFileSync } from 'node:fs';
const moduleFixture: LibraryExample = {
	id: 'fixture',
	provider: 'lodash-es',
	title: 'Fixture',
	description: 'Test',
	category: 'Test',
	kind: 'action',
	docs: 'https://lodash.com',
	input: { values: [1, 2, 3] },
	module: 'https://esm.sh/lodash-es@4.17.21?bundle',
	code: 'return m.chunk(input.values,2)'
};

test('input caps and URL parameter boundaries fail closed', () => {
	assert.throws(() => parseExampleInput('[]'));
	assert.throws(() => parseExampleInput(JSON.stringify({ x: 'x'.repeat(17000) })));
	const example: LibraryExample = { ...moduleFixture, request: { url: 'https://api.github.com/repos/{owner}/{repo}' } };
	for (const owner of ['..', 'foo/bar', 'foo?bar', 'foo\\bar']) assert.throws(() => buildExampleRequest(example, { owner, repo: 'react' }));
	const url = buildExampleRequest(example, { owner: 'facebook', repo: 'react', url: 'https://evil.test' }).url;
	assert.equal(url.origin, 'https://api.github.com');
});
test('upstream streaming responses are bounded', async () => {
	await assert.rejects(readBoundedJson(new Response('x'.repeat(300000))), /256 KB/);
	await assert.rejects(readBoundedJson(new Response('secret details', { status: 403 })), (error) => !String(error).includes('secret details'));
	assert.deepEqual(await readBoundedJson(new Response('{"hello":true}')), { hello: true });
});
test('sandbox input never breaks out of a script and pure tasks run in terminable workers', () => {
	const example = moduleFixture;
	const html = exampleSandbox(example, { text: '</script><script>alert(1)</script>' }, 'fixture');
	assert.equal(html.match(/<script /g)?.length, 1);
	assert.ok(!html.includes('</script><script>'));
	assert.ok(html.includes('new Worker'));
	assert.ok(html.includes('worker.terminate()'));
	assert.ok(!html.includes('allow-same-origin'));
});
test('manifest registers the origin-scoped library route and rejects incompatible versions', () => {
	const manifest = thingtimeCapabilityManifest('https://example.test/path');
	assert.equal(manifest.origin, 'https://example.test');
	assert.equal(manifest.features['api.library-request'].version, '1.1.0');
	assert.ok(manifest.operations.some((x) => x.path === '/api/v1/library/request' && x.methods.includes('POST')));
	for (const version of ['', '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), false);
	for (const version of ['1.0.0', '1.0.1', '1.1.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), true);
	const routes = readFileSync(new URL('../../server/routes/api/[...].ts', import.meta.url), 'utf8');
	assert.ok(routes.includes("'v1/library/request'"));
});

test('reusable Things carry only sample inputs and a curated identifier', () => {
	for (const thing of exampleThings(moduleFixture, 'fixture')) {
		const result = validateThingtimeCrystal(thing.thingtime, thing.crystal);
		assert.ok(result.ok);
		if (thing.thingtime[0] === 'action' && result.ok) assert.deepEqual(result.crystal.steps, thing.crystal.steps);
	}
});
