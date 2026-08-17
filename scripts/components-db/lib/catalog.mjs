// Catalog assembly: 25 archetypes × 8 libraries × 5 variants = 1000 unique
// components, in one deterministic canonical order (archetype → library →
// variant). Archetype modules land progressively (the generation loop authors
// them in tranches); missing modules are reported, never fatal, so a partial
// catalog still generates its finished prefix.

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { LIBRARIES, LIBRARY_IDS } from './tokens.mjs';

export const ARCHETYPE_ORDER = [
	'button',
	'badge',
	'chip',
	'alert',
	'avatar',
	'card',
	'input',
	'form-field',
	'choice-controls',
	'select-menu',
	'slider-progress',
	'loading',
	'breadcrumb-pagination',
	'tabs-steps',
	'navbar',
	'table',
	'list',
	'timeline',
	'modal-drawer',
	'toast-notification',
	'tooltip-popover',
	'empty-states',
	'stat-metric',
	'marketing',
	'flow'
];

export const VARIANTS_PER_ARCHETYPE = 5;
export const TRANCHE_ONE_TARGET = ARCHETYPE_ORDER.length * LIBRARY_IDS.length * VARIANTS_PER_ARCHETYPE; // 1000

const archetypesDir = fileURLToPath(new URL('./archetypes/', import.meta.url));

export const loadArchetypes = async () => {
	const available = new Set(
		(await readdir(archetypesDir)).filter((file) => file.endsWith('.mjs')).map((file) => file.replace(/\.mjs$/, ''))
	);
	const loaded = new Map();
	const missing = [];
	const errors = [];

	for (const id of ARCHETYPE_ORDER) {
		if (!available.has(id)) {
			missing.push(id);
			continue;
		}
		try {
			const module = await import(path.join(archetypesDir, `${id}.mjs`));
			const archetype = module.archetype;
			if (!archetype || archetype.id !== id || typeof archetype.build !== 'function') {
				errors.push(`${id}: module must export { archetype } with matching id + build()`);
				continue;
			}
			if (!Array.isArray(archetype.variants) || archetype.variants.length !== VARIANTS_PER_ARCHETYPE) {
				errors.push(`${id}: must declare exactly ${VARIANTS_PER_ARCHETYPE} variants`);
				continue;
			}
			loaded.set(id, archetype);
		} catch (err) {
			errors.push(`${id}: failed to import — ${err?.message || err}`);
		}
	}

	const unknown = [...available].filter((id) => !ARCHETYPE_ORDER.includes(id));
	if (unknown.length) errors.push(`unknown archetype modules not in ARCHETYPE_ORDER: ${unknown.join(', ')}`);

	return { loaded, missing, errors };
};

// Build every definition the loaded archetypes yield, canonical order.
export const buildCatalog = async () => {
	const { loaded, missing, errors } = await loadArchetypes();
	const definitions = [];

	for (const id of ARCHETYPE_ORDER) {
		const archetype = loaded.get(id);
		if (!archetype) continue;
		for (const libraryId of LIBRARY_IDS) {
			const lib = LIBRARIES[libraryId];
			let defs;
			try {
				defs = archetype.build(lib);
			} catch (err) {
				errors.push(`${id}/${libraryId}: build() threw — ${err?.message || err}`);
				continue;
			}
			if (!Array.isArray(defs) || defs.length !== VARIANTS_PER_ARCHETYPE) {
				errors.push(`${id}/${libraryId}: build() must return exactly ${VARIANTS_PER_ARCHETYPE} definitions`);
				continue;
			}
			defs.forEach((def, index) => {
				const variant = archetype.variants[index];
				const expectedSlug = `${libraryId}-${id}-${variant}`;
				if (def?.slug !== expectedSlug) {
					errors.push(`${id}/${libraryId}[${index}]: slug '${def?.slug}' should be '${expectedSlug}'`);
				}
				definitions.push({
					...def,
					version: 1,
					source: { kind: 'archetype', archetype: id, variant, tranche: 1 }
				});
			});
		}
	}

	return { definitions, missing, errors };
};
