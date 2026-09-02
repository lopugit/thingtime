// CI guard for the components-db folder database.
//
// The catalog is 2,800 committed generated JSON files plus ~1,500 lines of
// generator/validator source, and the growth-loop runbook keeps appending
// archetypes toward 6,000. `generate.mjs --check` already validates a build,
// but it is a manual runbook step: nothing re-ran it on a push, so a bad
// archetype or a hand-edited component file reached `develop` unopposed and
// only failed later, at seed time or in a viewer's browser.
//
// Three properties, all derived — never a second copy of the expected values:
//   1. every definition still passes the caps that mirror the server
//      sanitizer and the client renderer allowlist
//   2. the committed folder database is byte-identical to what the generator
//      produces from source (no drift in either direction)
//   3. index.json is the manifest for exactly that catalog
//
// Pure `node --test`: no network, no database, no remix dependencies.

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { MANIFEST_FILE, buildFolderDatabase, dbRoot, stableStringify } from './generate.mjs';
import { MAX_RESOLVED_CHARS as RESOLVER_MAX_CHARS, MAX_RESOLVED_NODES as RESOLVER_MAX_NODES, REPEAT_HARD_CAP } from './lib/resolve.mjs';
import { MAX_RESOLVED_CHARS, validateDefinition } from './lib/validate.mjs';

// The live resolver, for the twin guards at the bottom. Read as TEXT, never
// imported: this suite stays dependency-free (no tsx, no remix), and the two
// things worth pinning are both lexical.
const TWIN = new URL('../../remix/app/components/ComponentsLibrary/componentTemplate.ts', import.meta.url);

const built = await buildFolderDatabase();

// Committed component files, keyed the same way buildFolderDatabase() keys
// them, so the comparison below is a set comparison and not a walk that can
// only ever notice the files it already expected to find.
const committedFiles = async () => {
	const componentsRoot = path.join(dbRoot, 'components');
	const libraries = await readdir(componentsRoot, { withFileTypes: true });
	const entries = new Map();
	for (const library of libraries) {
		if (!library.isDirectory()) continue;
		const files = await readdir(path.join(componentsRoot, library.name));
		for (const file of files) {
			if (!file.endsWith('.json')) continue;
			const relative = `components/${library.name}/${file}`;
			entries.set(relative, await readFile(path.join(dbRoot, relative), 'utf8'));
		}
	}
	return entries;
};

test('every generated component definition validates', () => {
	assert.deepEqual(built.errors, [], 'archetype modules must load without errors');
	assert.deepEqual(built.issues, [], 'definitions must satisfy the render/server caps');
	assert.ok(built.definitions.length > 0, 'the catalog must not be empty');
});

// Regression: the resolved-TEXT cap is what stops a token-heavy archetype
// from shipping a component that the live resolver would silently truncate.
// It counted `children` text only, so an archetype that expanded its tokens
// into PROP text — SVG `d` path data, style values, alt/title — spent none of
// the budget and generated clean at 262k resolved chars, 8x past the cap.
test('the resolved-text cap sees prop text, not just children', () => {
	const base = {
		slug: 'thingtime-prop-text-guard',
		name: 'Prop text guard',
		library: 'thingtime',
		category: 'test',
		description: 'Fixture proving the resolved-text cap charges prop text the way the resolver does.',
		tags: ['test'],
		args: [{ name: 'd', type: 'string', default: 'M0 0 L10 10 '.repeat(160) }]
	};
	const svg = (props) => ({
		ttRepeat: {
			count: 24,
			max: 24,
			node: { tag: 'svg', props: { viewBox: '0 0 10 10' }, children: [{ tag: 'path', props }] }
		}
	});

	// tokens in a prop: 24 repeats x 8 tokens x ~1,920 chars
	const inProps = validateDefinition({ ...base, render: { tag: 'div', children: [svg({ d: '{d}{d}{d}{d}{d}{d}{d}{d}' })] } });
	assert.equal(inProps.length, 1, `expected exactly one issue, got ${JSON.stringify(inProps)}`);
	assert.match(inProps[0], new RegExp(`chars of text \\(> ${MAX_RESOLVED_CHARS}\\)`));

	// the same shape without the token expansion still generates clean, so the
	// cap is charging expansion rather than merely the presence of props
	assert.deepEqual(validateDefinition({ ...base, render: { tag: 'div', children: [svg({ d: 'M0 0 L10 10' })] } }), []);
});

test('component slugs are unique across the whole catalog', () => {
	const slugs = built.definitions.map((def) => def.slug);
	assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug in the catalog');
});

test('the committed folder database is exactly what the generator produces', async () => {
	const committed = await committedFiles();
	const expected = new Map(built.files.map((entry) => [entry.relative, entry.payload]));

	// Report the SET difference first: a bare payload loop reports a missing
	// file as an undefined-vs-string diff and an orphan as nothing at all.
	const missing = [...expected.keys()].filter((relative) => !committed.has(relative));
	const orphaned = [...committed.keys()].filter((relative) => !expected.has(relative));
	assert.deepEqual(missing, [], 'run `node scripts/components-db/generate.mjs` — these are not committed');
	assert.deepEqual(orphaned, [], 'these files are not produced by any archetype — delete them');

	const drifted = [...expected.entries()]
		.filter(([relative, payload]) => committed.get(relative) !== payload)
		.map(([relative]) => relative);
	assert.deepEqual(drifted, [], 'committed component JSON differs from generator output — regenerate, do not hand-edit');
});

test('index.json is the manifest for exactly that catalog', async () => {
	const committed = await readFile(path.join(dbRoot, MANIFEST_FILE), 'utf8');
	assert.equal(committed, stableStringify(built.manifest), 'index.json is stale — regenerate the folder database');
	assert.equal(built.manifest.count, built.definitions.length);
	assert.equal(
		Object.values(built.manifest.libraries).reduce((total, count) => total + count, 0),
		built.definitions.length,
		'per-library counts must add up to the catalog'
	);
});

// The generator validates against resolve.mjs, but what a visitor actually
// sees is componentTemplate.ts. Every cap in lib/validate.mjs is a mirror of a
// number that lives in one of those two files, so the mirrors below are only
// worth anything while the two resolvers still agree. Both of these are
// invariants the sources assert in prose and nothing enforces.

test('the catalog never emits the runtime-only ttAction marker', () => {
	// componentTemplate.ts strips `ttAction`/`ttActionInputs` and folds them into
	// data-tt-action props; resolve.mjs has no such branch and emits them as
	// literal node keys that walkResolved does not inspect. The twin's header
	// calls that divergence safe *because* "the catalog generator never emits
	// one" — so hold the generator to it instead of trusting the comment.
	const offenders = built.definitions
		.filter((def) => /"ttAction(Inputs)?"/u.test(JSON.stringify(def.render)))
		.map((def) => def.slug);
	assert.deepEqual(offenders, [], 'these definitions carry an interactive marker resolve.mjs cannot resolve');

	const rejected = validateDefinition({
		slug: 'thingtime-runtime-marker-guard',
		name: 'Runtime marker guard',
		library: 'thingtime',
		category: 'test',
		description: 'Fixture proving the generator refuses the runtime-only ttAction marker.',
		tags: ['test'],
		args: [],
		render: { tag: 'button', ttAction: 'run-thing', children: ['Go'] }
	});
	assert.equal(rejected.length, 1, `expected exactly one issue, got ${JSON.stringify(rejected)}`);
	assert.match(rejected[0], /runtime-only marker/u);
});

test('the runtime twin declares the same expansion budgets', async () => {
	const source = await readFile(TWIN, 'utf8').catch(() => null);
	assert.ok(source, `componentTemplate.ts not found at ${TWIN.pathname} — update this guard if the twin moved`);

	// Only plain numeric literals live here (`4000`, `256 * 1024`), so refuse to
	// guess at anything else rather than silently comparing NaN.
	const twinConstant = (name) => {
		const match = new RegExp(`export const ${name} = ([^;]+);`, 'u').exec(source);
		assert.ok(match, `${name} is not exported from componentTemplate.ts`);
		assert.match(match[1], /^[\d\s*]+$/u, `${name} must stay a plain numeric literal for this guard to compare it`);
		return match[1].split('*').reduce((product, part) => product * Number(part), 1);
	};

	assert.equal(twinConstant('REPEAT_HARD_CAP'), REPEAT_HARD_CAP, 'ttRepeat hard cap drifted from resolve.mjs');
	assert.equal(twinConstant('MAX_RESOLVED_NODES'), RESOLVER_MAX_NODES, 'resolved-node budget drifted from resolve.mjs');
	assert.equal(twinConstant('MAX_RESOLVED_CHARS'), RESOLVER_MAX_CHARS, 'resolved-char budget drifted from resolve.mjs');

	// One budget per top-level resolve, in BOTH copies. A second budget literal
	// is exactly how a fresh per-subtree budget gets introduced, and that
	// multiplies the whole-tree ceiling by the node count.
	const budgets = (text) => text.match(/\{ left: MAX_RESOLVED_NODES, chars: MAX_RESOLVED_CHARS \}/gu)?.length ?? 0;
	assert.equal(budgets(source), 1, 'componentTemplate.ts must construct exactly one resolve budget');
	assert.equal(budgets(await readFile(new URL('./lib/resolve.mjs', import.meta.url), 'utf8')), 1, 'resolve.mjs must construct exactly one resolve budget');
});

test('importing the generator never writes to the repository', async () => {
	// buildFolderDatabase returns payloads; the CLI guard in generate.mjs is
	// what keeps `import` from running run(). If that guard regresses, this
	// suite would rewrite components-db/ as a side effect of loading it — and
	// the drift test above would then pass no matter what.
	const source = await readFile(new URL('./generate.mjs', import.meta.url), 'utf8');
	assert.match(source, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/u);
	assert.equal(built.files.every((entry) => typeof entry.payload === 'string'), true);
});
