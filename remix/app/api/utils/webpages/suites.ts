import { getThingsCollection } from '../mongodb/collections';
import { createThing, fail, isFail, updateThing, type Fail, type Viewer } from '../things/things';
import { ACL_OWNER } from '~/schemas/registry';
import { materializeSuite, suiteEntryPageKey, type BehaviourSuite } from '~/schemas/behaviourSuites';
// Import the app-suite REGISTRY, not just the lookup: registration is a
// module side effect, and this route can be the first server module to run
// after a dev rebuild — without this import `pokeworld` would 404 here until
// some other module (seed, demos) happened to load the apps.
import { ALL_SUITES } from '~/schemas/appSuites/index';

// Server-side suite / app install: the suite's OWN-mode bundle written into
// the viewer's things through the ordinary create/update utils — the same
// path the gallery's part-by-part client install takes (FUNDAMENTALS §2), in
// ONE request and IDEMPOTENTLY. Every part has a stable key inside the
// viewer's things (schema by crystal.name, component by componentKey, action
// by actionKey, page by pageKey, sample data by its suiteSample stamp), so a
// second install UPDATES the existing thing in place instead of minting a
// duplicate: re-installing after the catalog changed is how an installed app
// picks up a new version, and the viewer keeps their data things.
//
// Reads here are the viewer's own docs by key (bounded, indexed on
// ownerId + thingtime); every write goes through createThing / updateThing,
// so ACL, quota, storage accounting and the kind gates all apply exactly as
// they would by hand.

export type InstallSuiteResult = {
	ok: true;
	suite: string;
	title: string;
	created: number;
	updated: number;
	// suite part key → the viewer's thing id
	schemaIds: Record<string, string>;
	componentIds: Record<string, string>;
	actionIds: Record<string, string>;
	pageIds: Record<string, string>;
	dataIds: string[];
	entryPageId: string;
	// the URL every viewer's copy answers at (/p/<entryPageKey>)
	entryPageKey: string;
};

type OwnDoc = { shareId: string; crystal: Record<string, unknown> };

const ownDocsByKey = async (viewerId: string, kind: string, field: string, keys: string[]): Promise<Map<string, OwnDoc>> => {
	const out = new Map<string, OwnDoc>();
	if (!keys.length) return out;
	const things = await getThingsCollection();
	const docs = await things
		.find({ ownerId: viewerId, thingtime: kind, [`crystal.${field}`]: { $in: keys } } as any, { projection: { shareId: 1, crystal: 1, createdAt: 1 } })
		.sort({ 'crystal.version': -1, createdAt: -1 })
		.limit(keys.length * 8)
		.toArray();
	for (const doc of docs as any[]) {
		const key = typeof doc.crystal?.[field] === 'string' ? doc.crystal[field] : null;
		// newest revision wins, exactly like the executor's actionKey resolution
		if (key && !out.has(key)) out.set(key, { shareId: doc.shareId, crystal: doc.crystal || {} });
	}
	return out;
};

const SAMPLE_STAMP = 'suiteSample';

export const installSuiteForViewer = async (viewer: Viewer, key: unknown): Promise<Fail | InstallSuiteResult> => {
	if (!viewer?.id) return fail(401, 'Sign in to install a suite');
	const suiteKey = typeof key === 'string' ? key.trim() : '';
	const suite: BehaviourSuite | null = suiteKey ? ALL_SUITES.find((entry) => entry.key === suiteKey) || null : null;
	if (!suite) return fail(404, `No suite matches "${suiteKey.slice(0, 40)}"`);

	const bundle = materializeSuite(suite, 'own');
	let created = 0;
	let updated = 0;

	const upsert = async (kind: string, existing: OwnDoc | undefined, crystal: Record<string, unknown>, label: string): Promise<string> => {
		if (existing) {
			// same content → nothing to write; otherwise refresh in place
			if (JSON.stringify(existing.crystal) === JSON.stringify(crystal)) return existing.shareId;
			const result = await updateThing(viewer, existing.shareId, { crystal });
			if (isFail(result)) throw new Error(`${label}: ${result.error}`);
			updated += 1;
			return existing.shareId;
		}
		const result = await createThing(viewer.id, { thingtime: [kind], crystal, acl: [ACL_OWNER] }, viewer);
		if (isFail(result)) throw new Error(`${label}: ${result.error}`);
		created += 1;
		return (result as { ok: true; doc: { shareId: string } }).doc.shareId;
	};

	try {
		// schemas first — their ids stamp the sample data exactly as the
		// executor stamps things it creates
		const schemaByName = await ownDocsByKey(viewer.id, 'schema', 'name', bundle.schemas.map((schema) => schema.crystal.name as string));
		const schemaIds: Record<string, string> = {};
		for (const schema of bundle.schemas) {
			schemaIds[schema.key] = await upsert('schema', schemaByName.get(schema.crystal.name as string), schema.crystal, `schema ${schema.slug}`);
		}

		const componentByKey = await ownDocsByKey(viewer.id, 'component', 'componentKey', bundle.components.map((component) => component.crystal.componentKey as string));
		const componentIds: Record<string, string> = {};
		for (const component of bundle.components) {
			componentIds[component.key] = await upsert('component', componentByKey.get(component.crystal.componentKey as string), component.crystal, `component ${component.slug}`);
		}

		const actionByKey = await ownDocsByKey(viewer.id, 'action', 'actionKey', bundle.actions.map((action) => action.crystal.actionKey as string));
		const actionIds: Record<string, string> = {};
		for (const action of bundle.actions) {
			actionIds[action.key] = await upsert('action', actionByKey.get(action.crystal.actionKey as string), action.crystal, `action ${action.slug}`);
		}

		// sample data is seeded ONCE per suite — a viewer's edits to their
		// samples are theirs, and a re-install must never clobber them
		const sampleStamps = bundle.data.map((entry) => `${suite.key}:${entry.index + 1}`);
		const sampleByStamp = await ownDocsByKey(viewer.id, 'data', SAMPLE_STAMP, sampleStamps);
		const dataIds: string[] = [];
		for (const entry of bundle.data) {
			const stamp = `${suite.key}:${entry.index + 1}`;
			const existing = sampleByStamp.get(stamp);
			if (existing) {
				dataIds.push(existing.shareId);
				continue;
			}
			const crystal = { ...entry.crystal, schemaId: schemaIds[entry.schemaKey], [SAMPLE_STAMP]: stamp };
			const result = await createThing(viewer.id, { thingtime: ['data'], crystal, acl: [ACL_OWNER] }, viewer);
			if (isFail(result)) throw new Error(`data ${entry.shareId}: ${result.error}`);
			created += 1;
			dataIds.push((result as { ok: true; doc: { shareId: string } }).doc.shareId);
		}

		// pages keep their pageKey: that is what makes /p/<pageKey> resolve the
		// viewer's copy ahead of the seeded one
		const pageByKey = await ownDocsByKey(viewer.id, 'webpage', 'pageKey', bundle.pages.map((page) => page.pageKey));
		const pageIds: Record<string, string> = {};
		for (const page of bundle.pages) {
			const crystal = { ...page.crystal, forkOf: page.shareId };
			pageIds[page.key] = await upsert('webpage', pageByKey.get(page.pageKey), crystal, `page ${page.slug}`);
		}

		return {
			ok: true,
			suite: suite.key,
			title: suite.title,
			created,
			updated,
			schemaIds,
			componentIds,
			actionIds,
			pageIds,
			dataIds,
			entryPageId: pageIds[bundle.pages[0].key],
			entryPageKey: suiteEntryPageKey(suite)
		};
	} catch (error) {
		return fail(422, `Install stopped: ${(error instanceof Error ? error.message : String(error)).slice(0, 400)}`);
	}
};
