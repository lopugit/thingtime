import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Exact-id unlisted page reads share the canonical Thing gate; listings remain fenced.

const utilsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...segments: string[]) => readFileSync(resolve(utilsDir, ...segments), 'utf8');

test('resolveWebpage carries canonical permalink authority into rendering', () => {
	const webpages = read('webpages', 'webpages.ts');
	const idArm = webpages.slice(webpages.indexOf('const collection = await getThingsCollection();\n\tconst visibility'));
	assert.ok(idArm, 'resolveWebpage must still resolve ?id= through a visibility-fenced lookup');

	assert.match(
		idArm,
		/withThingLink\(viewer, doc.shareId\)/,
		'the resolved page must carry exact permalink context into component rendering'
	);
	assert.match(
		idArm,
		/findViewableThing\(/,
		'admit key holders through the same authority /api/v1/things uses (findViewableThing → canView), not a hand-rolled acl check'
	);
	assert.match(idArm, /includes\('webpage'\)/, 'the key path must still refuse to serve a non-webpage thing through /p/');
});

test('the permalink path only widens an exact-id lookup miss', () => {
	const webpages = read('webpages', 'webpages.ts');
	const guard = webpages.match(/if \(!doc\) \{\s*const byKey = await findViewableThing[\s\S]*?\n\t\}/);
	assert.ok(guard, 'the exact-id fallback only follows a missed listing lookup');
	assert.ok(
		guard[0].indexOf('findViewableThing(') > 0,
		'the fallback body is the only place the unfenced lookup may happen'
	);
	// it must sit AFTER the fenced query — never replace it
	assert.ok(
		webpages.indexOf('await collection.findOne(match as any)') < webpages.indexOf('const byKey = await findViewableThing'),
		'the ordinary visibility-fenced lookup stays first; the key is a fallback, not a bypass'
	);
});

test('visibilityQueryFor still has no link-key clause, so hidden pages stay out of feeds and search', () => {
	const things = read('things', 'things.ts');
	const fn = things.slice(things.indexOf('export const visibilityQueryFor'));
	const body = fn.slice(0, fn.indexOf('\n};'));
	assert.ok(body.length > 0, 'visibilityQueryFor must still exist');
	assert.doesNotMatch(
		body,
		/linkKey/,
		'a linkKey clause here would surface unlisted things in every listing path that presents a key — the narrow resolveWebpage fallback is the right place instead'
	);
});

test('the route still hands resolveWebpage the presented key', () => {
	const route = readFileSync(
		resolve(utilsDir, '..', '..', 'routes', 'api', 'v1', 'webpages', 'resolve', '_resolve.tsx'),
		'utf8'
	);
	assert.match(route, /withLinkKeys\(/, 'the resolve route must keep wrapping the viewer with the presented ?key=');
	assert.match(route, /params\.get\('key'\)/, 'the key comes off the query string');
});
