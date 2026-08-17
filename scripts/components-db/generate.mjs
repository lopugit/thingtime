#!/usr/bin/env node
// Generate the components-db folder database from the archetype catalog.
//
//   node scripts/components-db/generate.mjs            build + write everything available
//   node scripts/components-db/generate.mjs --check    validate only (no writes)
//   node scripts/components-db/generate.mjs --archetype button   scope either mode
//
// Output: components-db/components/<library>/<slug>.json (one file per
// component — the folder database) + components-db/index.json manifest.
// Deterministic: same inputs → byte-identical outputs, so re-runs are
// idempotent and loop tranches only ever append.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { ARCHETYPE_ORDER, TRANCHE_ONE_TARGET, buildCatalog } from './lib/catalog.mjs';
import { validateDefinition } from './lib/validate.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const dbRoot = path.join(repoRoot, 'components-db');

const flags = new Set(process.argv.slice(2).filter((token) => token.startsWith('--')));
const archetypeScope = (() => {
	const index = process.argv.indexOf('--archetype');
	return index !== -1 ? process.argv[index + 1] : null;
})();
const checkOnly = flags.has('--check');

const stableStringify = (value) => `${JSON.stringify(value, null, '\t')}\n`;

const run = async () => {
	const { definitions, missing, errors } = await buildCatalog();
	const scoped = archetypeScope
		? definitions.filter((def) => def.source.archetype === archetypeScope)
		: definitions;

	if (archetypeScope && !ARCHETYPE_ORDER.includes(archetypeScope)) {
		console.error(`unknown archetype '${archetypeScope}' — expected one of: ${ARCHETYPE_ORDER.join(', ')}`);
		process.exit(1);
	}

	const issues = [...errors];
	const slugs = new Set();
	for (const def of scoped) {
		if (slugs.has(def.slug)) issues.push(`duplicate slug ${def.slug}`);
		slugs.add(def.slug);
		issues.push(...validateDefinition(def));
	}

	console.log(
		`catalog: ${definitions.length}/${TRANCHE_ONE_TARGET} definitions built` +
			(archetypeScope ? ` (${scoped.length} in scope '${archetypeScope}')` : '') +
			(missing.length ? ` — ${missing.length} archetypes not yet authored: ${missing.join(', ')}` : ' — all archetypes present')
	);

	if (issues.length) {
		console.error(`\n${issues.length} validation issue(s):`);
		for (const issue of issues.slice(0, 60)) console.error(`  ✗ ${issue}`);
		if (issues.length > 60) console.error(`  … and ${issues.length - 60} more`);
		process.exit(1);
	}
	console.log('validation: all definitions clean ✓');

	if (checkOnly) return;

	let written = 0;
	let unchanged = 0;
	for (const def of scoped) {
		const dir = path.join(dbRoot, 'components', def.library);
		await mkdir(dir, { recursive: true });
		const file = path.join(dir, `${def.slug}.json`);
		const payload = stableStringify(def);
		const existing = await readFile(file, 'utf8').catch(() => null);
		if (existing === payload) {
			unchanged += 1;
			continue;
		}
		await writeFile(file, payload);
		written += 1;
	}

	// Manifest covers the WHOLE built catalog (not just the scoped slice) so
	// index.json always reflects the true folder-db state.
	const manifest = {
		target: TRANCHE_ONE_TARGET,
		count: definitions.length,
		archetypesPresent: ARCHETYPE_ORDER.filter((id) => !missing.includes(id)),
		archetypesMissing: missing,
		libraries: {},
		hash: createHash('sha256').update(definitions.map((def) => def.slug).join('\n')).digest('hex').slice(0, 16)
	};
	for (const def of definitions) {
		manifest.libraries[def.library] = (manifest.libraries[def.library] || 0) + 1;
	}
	await mkdir(dbRoot, { recursive: true });
	await writeFile(path.join(dbRoot, 'index.json'), stableStringify(manifest));

	console.log(`write: ${written} written, ${unchanged} unchanged → components-db/ (manifest count ${manifest.count})`);
};

run().catch((err) => {
	console.error('generate crashed:', err);
	process.exit(1);
});
