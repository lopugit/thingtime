import { installMaterializedSuite, type InstallSuiteResult } from '~/schemas/suiteInstallation';
import { getThingsCollection } from '../mongodb/collections';
import { createThing, fail, isFail, updateThing, type Fail, type Viewer } from '../things/things';
import { ACL_OWNER } from '~/schemas/registry';
import { type BehaviourSuite } from '~/schemas/behaviourSuites';
// Import the app-suite REGISTRY, not just the lookup: registration is a
// module side effect, and this route can be the first server module to run
// after a dev rebuild — without this import `pokeworld` would 404 here until
// some other module (seed, demos) happened to load the apps.
import { ALL_SUITES } from '~/schemas/appSuites/index';
export type { InstallSuiteResult } from '~/schemas/suiteInstallation';

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

type OwnDoc = { shareId: string; crystal: Record<string, unknown> };

const ownDocsByKey = async (viewerId: string, kind: string, field: string, keys: string[]): Promise<Map<string, OwnDoc>> => {
	const out = new Map<string, OwnDoc>();
	if (!keys.length) return out;
	const things = await getThingsCollection();
	const docs = await things
		.find({ ownerId: viewerId, thingtime: kind, [`crystal.${field}`]: { $in: keys } } as any, {
			projection: { shareId: 1, crystal: 1, createdAt: 1 }
		})
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

export const installSuiteForViewer = async (
	viewer: Viewer,
	key: unknown,
	options: { onlyMissing?: boolean } = {}
): Promise<Fail | InstallSuiteResult> => {
	if (!viewer?.id) return fail(401, 'Sign in to install a suite');
	const suiteKey = typeof key === 'string' ? key.trim() : '';
	const suite: BehaviourSuite | null = suiteKey ? ALL_SUITES.find((entry) => entry.key === suiteKey) || null : null;
	if (!suite) return fail(404, `No suite matches "${suiteKey.slice(0, 40)}"`);

	try {
		return await installMaterializedSuite(
			suite,
			{
				find: (kind, field, keys) => ownDocsByKey(viewer.id, kind, field, keys),
				create: async (kind, crystal) => {
					const result = await createThing(viewer.id, { thingtime: [kind], crystal, acl: [ACL_OWNER] }, viewer);
					if (isFail(result)) throw new Error(result.error);
					return (result as { ok: true; doc: { shareId: string } }).doc.shareId;
				},
				update: async (id, crystal) => {
					const result = await updateThing(viewer, id, { crystal });
					if (isFail(result)) throw new Error(result.error);
				}
			},
			options
		);
	} catch (error) {
		return fail(422, `Install stopped: ${(error instanceof Error ? error.message : String(error)).slice(0, 400)}`);
	}
};
