import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// A hidden 🕵️ page's audience is its secret linkKey, and NOTHING else.
//
// /api/v1/things gates reads with canView, which honours viewer.linkKeys — so
// /post/<id>?key= and /thing/<id>?key= work. resolveWebpage does not: its ?id=
// arm gates entirely inside Mongo, via visibilityQueryFor, which only knows
// circles, own-things and grants. tt:hidden matches no viewer by design, so a
// hidden page can never come back from that query no matter who asks.
//
// That made the whole /p/ half of the feature inert: p.tsx read ?key=,
// useWebpage forwarded it, _resolve.tsx wrapped the viewer in withLinkKeys —
// and then the resolver never consulted it. Every secret page link the Builder
// drawer's "🕵️ Copy secret link" button produced 404'd for everyone except the
// owner, who could see the page anyway. Four files carried the key faithfully
// and the fifth dropped it.
//
// tsc cannot see this: a threaded-but-unread Viewer field is perfectly typed,
// and the resolver's own query looks like a complete visibility gate. Pin the
// seam, beside the Feed's hidden-link and audience-cancel contracts.

const utilsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...segments: string[]) => readFileSync(resolve(utilsDir, ...segments), 'utf8');

test('resolveWebpage consults the presented link key instead of only threading it', () => {
	const webpages = read('webpages', 'webpages.ts');
	const idArm = webpages.slice(webpages.indexOf('const collection = await getThingsCollection();\n\tconst visibility'));
	assert.ok(idArm, 'resolveWebpage must still resolve ?id= through a visibility-fenced lookup');

	assert.match(
		idArm,
		/viewer\?\.linkKeys\?\.size/,
		'the ?id= arm must consult the keys the reader presented — otherwise withLinkKeys is decoration'
	);
	assert.match(
		idArm,
		/findViewableThing\(/,
		'admit key holders through the same authority /api/v1/things uses (findViewableThing → canView), not a hand-rolled acl check'
	);
	assert.match(idArm, /includes\('webpage'\)/, 'the key path must still refuse to serve a non-webpage thing through /p/');
});

test('the key path only ever widens a MISS, and only for a presented key', () => {
	const webpages = read('webpages', 'webpages.ts');
	const guard = webpages.match(/if \(!doc && viewer\?\.linkKeys\?\.size\) \{[\s\S]*?\n\t\}/);
	assert.ok(guard, 'the fallback must be gated on both a missed primary lookup AND a presented key');
	assert.ok(
		guard[0].indexOf('findViewableThing(') > 0,
		'the fallback body is the only place the unfenced lookup may happen'
	);
	// it must sit AFTER the fenced query — never replace it
	assert.ok(
		webpages.indexOf('await collection.findOne(match as any)') < webpages.indexOf('if (!doc && viewer?.linkKeys?.size)'),
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
