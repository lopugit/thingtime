import { ensureIndexes, getThingsCollection } from '../mongodb/collections';
import { toBin } from '../auth/users';
import { COMPONENT_RESERVED_ID_PREFIX } from '../things/things';
import {
	ACL_ALL,
	COLLECTION_SCHEMA_VERSIONS,
	COMPONENT_KEY_PATTERN,
	MAX_COMPONENT_KEY_CHARS,
	validateThingtimeCrystal
} from '~/schemas/registry';

// Seed the platform component library (components-db) as system-owned public
// component things — the same envelope contract as the seed-builtin-schemas
// migration: ownerId 'system', storageClass 'control', acl ['tt:all'],
// deterministic shareId component-<slug> (prefix reserved in sanitizeShareId),
// uniqueKeys ['component:<slug>'], reconciling upserts that self-heal drift
// and refuse to touch foreign docs squatting a destination id. Crystals pass
// validateThingtimeCrystal(['component']) — the exact write gate user
// components clear — so seeded and user-authored components share one grammar.
// The envelope stays hand-built (not createThing) because it needs the same
// system-only powers the schema seed does.

const MAX_SEED_BATCH = 100;

// Provenance tag stamped on every seeded catalog component. Seed envelopes are
// hand-built (never sanitizeTags), so the display casing survives verbatim —
// user-saved copies ride createThing, which lowercases tags by grammar.
export const COMPONENT_ATTRIBUTION_TAG = 'Made by Fable 5 Ultracode';

export type SeedComponentsResult = {
	ok: true;
	received: number;
	created: number;
	refreshed: number;
	unchanged: number;
	skipped: number;
	notes: string[];
	totalSeeded: number;
};

type SeedFail = { ok: false; status: number; error: string };

const fail = (status: number, error: string): SeedFail => ({ ok: false, status, error });

const genuineSeededComponent = (twin: any): boolean =>
	!!twin && Array.isArray(twin.thingtime) && twin.thingtime.includes('component') && twin.ownerId === 'system';

const seededCount = async (): Promise<number> => {
	const things = await getThingsCollection();
	return things.countDocuments({ thingtime: 'component', ownerId: 'system' } as any);
};

export const countSeededComponents = async (): Promise<{ ok: true; totalSeeded: number }> => ({
	ok: true,
	totalSeeded: await seededCount()
});

export const seedComponents = async (input: unknown): Promise<SeedFail | SeedComponentsResult> => {
	if (!Array.isArray(input)) return fail(400, 'components must be a list of component definitions');
	if (!input.length) return fail(400, 'components list is empty');
	if (input.length > MAX_SEED_BATCH) return fail(400, `Seed at most ${MAX_SEED_BATCH} components per call`);

	await ensureIndexes();
	const things = await getThingsCollection();
	const notes: string[] = [];
	let created = 0;
	let refreshed = 0;
	let unchanged = 0;
	let skipped = 0;

	for (const entry of input) {
		const def = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
		const slug = def && typeof def.slug === 'string' ? def.slug.trim() : '';
		if (!def || !slug || slug.length > MAX_COMPONENT_KEY_CHARS || !COMPONENT_KEY_PATTERN.test(slug)) {
			notes.push(`skipped: definition without a valid slug (${String(def?.slug).slice(0, 60)})`);
			skipped += 1;
			continue;
		}

		const validated = validateThingtimeCrystal(['component'], {
			name: def.name,
			description: def.description,
			library: def.library,
			category: def.category,
			componentKey: slug,
			familyKey: def.familyKey,
			version: def.version ?? 1,
			args: def.args,
			render: def.render,
			previewBg: def.previewBg
		});
		if (validated.ok === false) {
			notes.push(`skipped ${slug}: ${validated.error}`);
			skipped += 1;
			continue;
		}

		// attribution leads so it can never be squeezed out by the per-definition
		// tags below (MAX_TAGS is 12; the definition tags stop at 10)
		const tags = [COMPONENT_ATTRIBUTION_TAG, 'component'];
		const library = typeof validated.crystal.library === 'string' ? validated.crystal.library : '';
		const category = typeof validated.crystal.category === 'string' ? validated.crystal.category : '';
		if (library) tags.push(library);
		if (category && !tags.includes(category)) tags.push(category);
		// Dedupe on the NORMALISED value: comparing the raw string let a
		// definition tag of 'Antd' (or ' antd ') slip past a library/category
		// entry already seeded above, so the thing shipped duplicate tags.
		for (const raw of Array.isArray(def.tags) ? def.tags : []) {
			if (typeof raw !== 'string') continue;
			const tag = raw.trim().toLowerCase();
			if (!tag || tag.length > 40 || tags.length >= 11 || tags.includes(tag)) continue;
			tags.push(tag);
		}

		const shareId = `${COMPONENT_RESERVED_ID_PREFIX}${slug}`;
		const now = new Date();
		const thing = {
			shareId,
			schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
			thingtime: validated.thingtime,
			crystal: validated.crystal,
			ownerId: 'system',
			storageClass: 'control',
			acl: [ACL_ALL],
			targetId: null,
			tags,
			uniqueKeys: [toBin(`component:${slug}`)],
			createdAt: now,
			updatedAt: now
		};

		try {
			const res = await things.updateOne({ shareId } as any, { $setOnInsert: thing }, { upsert: true });
			if (res.upsertedCount) {
				created += 1;
				continue;
			}
			const twin = await things.findOne({ shareId } as any);
			if (!genuineSeededComponent(twin)) {
				notes.push(`skipped ${slug}: shareId held by a foreign doc — left unseeded`);
				skipped += 1;
				continue;
			}
			const crystalDrifted = JSON.stringify(twin!.crystal ?? {}) !== JSON.stringify(validated.crystal);
			const tagsDrifted = JSON.stringify(twin!.tags ?? []) !== JSON.stringify(tags);
			const storageDrifted = twin!.storageClass !== 'control';
			if (crystalDrifted || tagsDrifted || storageDrifted) {
				// genuineness lives IN the filter — a foreign doc matches nothing
				await things.updateOne({ shareId, ownerId: 'system', thingtime: 'component' } as any, {
					$set: { crystal: validated.crystal, tags, storageClass: 'control', updatedAt: now }
				});
				refreshed += 1;
				continue;
			}
			unchanged += 1;
		} catch (err: any) {
			notes.push(`skipped ${slug}: write failed (${err?.codeName || err?.message || 'unknown error'})`);
			skipped += 1;
		}
	}

	return {
		ok: true,
		received: input.length,
		created,
		refreshed,
		unchanged,
		skipped,
		notes: notes.slice(0, 40),
		totalSeeded: await seededCount()
	};
};
