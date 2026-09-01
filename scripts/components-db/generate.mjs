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
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { ARCHETYPE_ORDER, CATALOG_TARGET, buildCatalog } from './lib/catalog.mjs';
import { validateDefinition } from './lib/validate.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const dbRoot = path.join(repoRoot, 'components-db');

export const stableStringify = (value) => `${JSON.stringify(value, null, '\t')}\n`;

export const MANIFEST_FILE = 'index.json';

// The whole folder database as VALUES: exactly the bytes `run()` would write,
// with nothing written. One producer for both the CLI and catalog.test.mjs, so
// the drift guard can never assert against a second, quietly diverging copy of
// this layout.
export const buildFolderDatabase = async ({ archetype = null } = {}) => {
	const { definitions, missing, errors } = await buildCatalog();
	const scoped = archetype ? definitions.filter((def) => def.source.archetype === archetype) : definitions;

	const issues = [...errors];
	const slugs = new Set();
	for (const def of scoped) {
		if (slugs.has(def.slug)) issues.push(`duplicate slug ${def.slug}`);
		slugs.add(def.slug);
		issues.push(...validateDefinition(def));
	}

	// Manifest covers the WHOLE built catalog (not just the scoped slice) so
	// index.json always reflects the true folder-db state.
	const manifest = {
		target: CATALOG_TARGET,
		count: definitions.length,
		archetypesPresent: ARCHETYPE_ORDER.filter((id) => !missing.includes(id)),
		archetypesMissing: missing,
		libraries: {},
		hash: createHash('sha256').update(definitions.map((def) => def.slug).join('\n')).digest('hex').slice(0, 16)
	};
	for (const def of definitions) {
		manifest.libraries[def.library] = (manifest.libraries[def.library] || 0) + 1;
	}

	const files = scoped.map((def) => ({
		// posix-joined: this is a repo-relative key compared against committed
		// paths, not a filesystem path to open
		relative: `components/${def.library}/${def.slug}.json`,
		payload: stableStringify(def)
	}));

	return { definitions, scoped, missing, errors, issues, files, manifest };
};

const run = async () => {
	const flags = new Set(process.argv.slice(2).filter((token) => token.startsWith('--')));
	const archetypeIndex = process.argv.indexOf('--archetype');
	const archetypeScope = archetypeIndex !== -1 ? process.argv[archetypeIndex + 1] : null;
	const checkOnly = flags.has('--check');

	if (archetypeScope && !ARCHETYPE_ORDER.includes(archetypeScope)) {
		console.error(`unknown archetype '${archetypeScope}' — expected one of: ${ARCHETYPE_ORDER.join(', ')}`);
		process.exit(1);
	}

	const { definitions, scoped, missing, issues, files, manifest } = await buildFolderDatabase({ archetype: archetypeScope });

	console.log(
		`catalog: ${definitions.length}/${CATALOG_TARGET} definitions built` +
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
	for (const entry of files) {
		const file = path.join(dbRoot, entry.relative);
		await mkdir(path.dirname(file), { recursive: true });
		const existing = await readFile(file, 'utf8').catch(() => null);
		if (existing === entry.payload) {
			unchanged += 1;
			continue;
		}
		await writeFile(file, entry.payload);
		written += 1;
	}

	await mkdir(dbRoot, { recursive: true });
	await writeFile(path.join(dbRoot, MANIFEST_FILE), stableStringify(manifest));

	console.log(`write: ${written} written, ${unchanged} unchanged → components-db/ (manifest count ${manifest.count})`);
};

// CLI only. catalog.test.mjs imports buildFolderDatabase from here, and an
// import must never write to the repository or call process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	run().catch((err) => {
		console.error('generate crashed:', err);
		process.exit(1);
	});
}
