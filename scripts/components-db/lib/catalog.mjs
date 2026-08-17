// Catalog assembly: 25 archetypes × 8 libraries × 5 variants = 1000 unique
// components, in one deterministic canonical order (archetype → library →
// variant). Archetype modules land progressively (the generation loop authors
// them in tranches); missing modules are reported, never fatal, so a partial
// catalog still generates its finished prefix.

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { LIBRARIES, LIBRARY_IDS } from './tokens.mjs';

// Tranche 1: the original 25 archetypes (×8 libraries ×5 variants = 1000).
// Tranche 2 grows the catalog beyond 1000 — new archetypes append below the
// TRANCHE_2_START marker so tranche-1 output never reorders.
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
	'flow',
	// ---- tranche 2 ----
	'rating',
	'code-block',
	'search-command',
	'chat',
	'media-player',
	'date-time',
	'commerce',
	'profile-social',
	'data-viz',
	'file-manager',
	'onboarding',
	'window-chrome',
	'kanban',
	'forms-advanced',
	'gamification',
	'settings',
	'mail',
	'schedule',
	'map-travel',
	'banking',
	'docs-wiki',
	'health-fitness',
	'smart-home',
	'social-feed',
	'dev-tools',
	'education',
	'food-delivery',
	'crypto-trading',
	'events-tickets',
	'support-help'
];

export const VARIANTS_PER_ARCHETYPE = 5;
export const TRANCHE_ONE_ARCHETYPES = 25;
export const TRANCHE_ONE_TARGET = TRANCHE_ONE_ARCHETYPES * LIBRARY_IDS.length * VARIANTS_PER_ARCHETYPE; // 1000
export const trancheOf = (archetypeId) => (ARCHETYPE_ORDER.indexOf(archetypeId) < TRANCHE_ONE_ARCHETYPES ? 1 : 2);
export const CATALOG_TARGET = ARCHETYPE_ORDER.length * LIBRARY_IDS.length * VARIANTS_PER_ARCHETYPE;

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
					// familyKey groups the 8 library renditions of one functional
					// component — /components shows one card per family with a
					// designs click-through
					familyKey: `${id}-${variant}`,
					source: { kind: 'archetype', archetype: id, variant, tranche: trancheOf(id) }
				});
			});
		}
	}

	return { definitions, missing, errors };
};
