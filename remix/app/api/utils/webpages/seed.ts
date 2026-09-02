import { ensureIndexes, getThingsCollection } from '../mongodb/collections';
import { toBin } from '../auth/users';
import { WEBPAGE_RESERVED_ID_PREFIX } from '../things/things';
import { ACL_ALL, COLLECTION_SCHEMA_VERSIONS, validateThingtimeCrystal } from '~/schemas/registry';
import { BEHAVIOUR_SUITES, materializeSuite } from '~/schemas/behaviourSuites';
import { WEBPAGE_DEMO_SLUG_PREFIX, getWebpageDemos, webpageDemoCrystal } from '~/schemas/webpageDemos';
import { SITE_GLOBAL_PAGE_KEY } from './webpages';

// Seed the built-in SITE PAGES: one system-owned webpage thing per app route
// (shareId webpage-route-<key>) whose block list is just the locked native
// block for that screen, plus the empty site-global doc. This is what makes
// every existing Thingtime page a block-based site: the SiteBlocksHost
// resolves these docs per route, users personalise by forking into a
// viewer-owned twin (same pageKey/siteRoute), and the system defaults stay
// untouched. Same envelope contract as the component/schema seeds: ownerId
// 'system', storageClass 'control', acl ['tt:all'], reserved prefix,
// uniqueKeys, reconciling genuineness-fenced upserts. The definitions live
// server-side (deterministic table) so seeding takes no payload.
//
// The DEMO LIBRARY rides the same upsert: webpage demos (shareId
// webpage-demo-<slug>) from the deterministic schemas/webpageDemos catalog,
// and BEHAVIOUR SUITES (schemas/behaviourSuites) — bundles of schema,
// component, action, data, and webpage things that together demonstrate a
// program. One admin POST seeds hundreds of example things, every demo opens
// at /p/ and in the builder, and every suite part is browsable on its kind's
// page (viewers fork or install, never edit the seed).

type SitePageSeed = {
	key: string; // route key → shareId webpage-route-<key>, native block key
	path: string; // crystal.siteRoute
	name: string;
	// pages decomposed in the client native-section registry
	// (remix/app/components/Builder/nativeSections.tsx) seed one native block
	// PER SECTION instead of a single whole-page native — keep the two lists
	// in sync when converting a page
	sections?: string[];
};

export const SITE_PAGE_SEEDS: SitePageSeed[] = [
	{ key: 'home', path: '/', name: 'Home', sections: ['home-hero', 'home-demo', 'home-use-cases', 'home-ecosystem', 'home-developers', 'home-back', 'home-faq', 'home-footer'] },
	{ key: 'feed', path: '/feed', name: 'Feed' },
	{ key: 'messages', path: '/messages', name: 'Messages' },
	{ key: 'search', path: '/search', name: 'Search' },
	{ key: 'schemas', path: '/schemas', name: 'Schemas' },
	{ key: 'components', path: '/components', name: 'Components' },
	{ key: 'actions', path: '/actions', name: 'Actions' },
	{ key: 'things', path: '/things', name: 'Things' },
	{ key: 'settings', path: '/settings', name: 'Settings' },
	{ key: 'profile', path: '/profile', name: 'Profile' },
	{ key: 'themes', path: '/themes', name: 'Themes' },
	{ key: 'status', path: '/status', name: 'Status', sections: ['status-header', 'status-state', 'status-readout', 'status-recheck'] },
	{ key: 'vercel', path: '/vercel', name: 'Deployments' },
	{ key: 'mongodb-status', path: '/mongodb-status', name: 'MongoDB', sections: ['mongodb-status-header', 'mongodb-status-connection', 'mongodb-status-endpoint'] },
	{ key: 'migrations', path: '/migrations', name: 'Migrations' },
	{ key: 'tests', path: '/tests', name: 'API tests' },
	{ key: 'admin', path: '/admin', name: 'Admin' },
	{ key: 'apps', path: '/apps', name: 'App data' },
	{ key: 'apps-manage', path: '/apps/manage', name: 'My apps' },
	{ key: 'branding', path: '/branding', name: 'Branding' },
	{ key: 'docs', path: '/docs', name: 'Docs' },
	{ key: 'welcome', path: '/welcome', name: 'Welcome', sections: ['welcome-hero', 'welcome-card'] },
	{ key: 'crypto', path: '/crypto', name: 'Crypto' },
	{ key: 'raw', path: '/raw', name: 'MongoDB query' },
	{ key: 'ode', path: '/ode', name: 'Ode', sections: ['ode-poem'] },
	{ key: 'builder', path: '/builder', name: 'Builder' },
	{ key: 'builder-demos', path: '/builder/demos', name: 'Builder demos' }
];

export type SeedWebpagesResult = {
	ok: true;
	received: number;
	created: number;
	refreshed: number;
	unchanged: number;
	skipped: number;
	notes: string[];
	totalSeeded: number;
};

export type SeedWebpagesCensus = {
	ok: true;
	// every system-owned webpage thing (site pages + global doc + demos)
	totalSeeded: number;
	siteSeeded: number;
	demosSeeded: number;
	demosTotal: number;
	// suites count by their seeded PAGE (one per suite)
	suitesSeeded: number;
	suitesTotal: number;
};

type SeedFail = { ok: false; status: number; error: string };

const fail = (status: number, error: string): SeedFail => ({ ok: false, status, error });

const seededCount = async (tag?: string, withoutTag?: string): Promise<number> => {
	const things = await getThingsCollection();
	const tagged = tag ? { tags: withoutTag ? { $all: [tag], $nin: [withoutTag] } : tag } : {};
	return things.countDocuments({ thingtime: 'webpage', ownerId: 'system', ...tagged } as any);
};

export const countSeededWebpages = async (): Promise<SeedWebpagesCensus> => ({
	ok: true,
	totalSeeded: await seededCount(),
	siteSeeded: await seededCount('site'),
	// suite pages carry BOTH 'demo' (so the gallery's seeded projection finds
	// them) and 'suite', so the demo census must exclude them — otherwise
	// demosSeeded counts the 14 suite pages against demosTotal and a fully
	// seeded deployment reports more demos seeded than the catalog holds
	demosSeeded: await seededCount('demo', 'suite'),
	demosTotal: getWebpageDemos().length,
	suitesSeeded: await seededCount('suite'),
	suitesTotal: BEHAVIOUR_SUITES.length
});

// One system thing to upsert: the kind names its gate, the shareId carries
// the kind's reserved prefix, and uniqueKey namespaces stay per kind so the
// demo docs never collide with the builtin schema/component seeds.
type SeedDefinition = {
	shareId: string;
	uniqueKey: string;
	kind: string;
	tags: string[];
	crystalInput: Record<string, unknown>;
};

const genuineSeeded = (twin: any, kind: string): boolean =>
	!!twin && Array.isArray(twin.thingtime) && twin.thingtime.includes(kind) && twin.ownerId === 'system';

// Reconciling upsert shared by every seed here: insert missing docs, refresh
// drifted genuine ones in place, and never touch a foreign doc squatting a
// destination id (genuineness lives IN the update filter).
const upsertSystemThings = async (definitions: SeedDefinition[]): Promise<SeedWebpagesResult> => {
	await ensureIndexes();
	const things = await getThingsCollection();
	const notes: string[] = [];
	let created = 0;
	let refreshed = 0;
	let unchanged = 0;
	let skipped = 0;

	for (const def of definitions) {
		const validated = validateThingtimeCrystal([def.kind], def.crystalInput);
		if (validated.ok === false) {
			notes.push(`skipped ${def.shareId}: ${validated.error}`);
			skipped += 1;
			continue;
		}

		const { shareId, tags } = def;
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
			uniqueKeys: [toBin(def.uniqueKey)],
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
			if (!genuineSeeded(twin, def.kind)) {
				notes.push(`skipped ${shareId}: shareId held by a foreign doc — left unseeded`);
				skipped += 1;
				continue;
			}
			const crystalDrifted = JSON.stringify(twin!.crystal ?? {}) !== JSON.stringify(validated.crystal);
			const tagsDrifted = JSON.stringify(twin!.tags ?? []) !== JSON.stringify(tags);
			const storageDrifted = twin!.storageClass !== 'control';
			if (crystalDrifted || tagsDrifted || storageDrifted) {
				// genuineness lives IN the filter — a foreign doc matches nothing
				await things.updateOne({ shareId, ownerId: 'system', thingtime: def.kind } as any, {
					$set: { crystal: validated.crystal, tags, storageClass: 'control', updatedAt: now }
				});
				refreshed += 1;
				continue;
			}
			unchanged += 1;
		} catch (err: any) {
			notes.push(`skipped ${shareId}: write failed (${err?.codeName || err?.message || 'unknown error'})`);
			skipped += 1;
		}
	}

	return {
		ok: true,
		received: definitions.length,
		created,
		refreshed,
		unchanged,
		skipped,
		notes: notes.slice(0, 40),
		totalSeeded: await seededCount()
	};
};

const webpageDefinition = (slug: string, tags: string[], crystalInput: Record<string, unknown>): SeedDefinition => ({
	shareId: `${WEBPAGE_RESERVED_ID_PREFIX}${slug}`,
	uniqueKey: `webpage:${slug}`,
	kind: 'webpage',
	tags,
	crystalInput
});

export const seedSiteWebpages = async (): Promise<SeedFail | SeedWebpagesResult> => {
	const tags = ['webpage', 'site'];
	const definitions: SeedDefinition[] = [
		...SITE_PAGE_SEEDS.map((seed) =>
			webpageDefinition(`route-${seed.key}`, tags, {
				name: seed.name,
				description: `Site page for ${seed.path} — personalise it with the builder's site edit mode.`,
				pageKey: `route-${seed.key}`,
				siteRoute: seed.path,
				version: 1,
				blocks: (seed.sections || [seed.key]).map((sectionKey) => ({
					id: `native-${sectionKey}`,
					type: 'native',
					native: sectionKey
				}))
			})
		),
		webpageDefinition(SITE_GLOBAL_PAGE_KEY, tags, {
			name: 'Global blocks',
			description: 'Blocks that render on every page and persist across navigation — personalise with the builder.',
			pageKey: SITE_GLOBAL_PAGE_KEY,
			version: 1,
			blocks: []
		})
	];
	return upsertSystemThings(definitions);
};

// The demo library: shareId webpage-demo-<slug>, tags carry the family so the
// gallery census and the seeded-flag projection are one indexed tag match.
export const seedDemoWebpages = async (): Promise<SeedFail | SeedWebpagesResult> =>
	upsertSystemThings(
		getWebpageDemos().map((demo) =>
			webpageDefinition(`${WEBPAGE_DEMO_SLUG_PREFIX}${demo.slug}`, ['webpage', 'demo', demo.family, demo.kind], webpageDemoCrystal(demo))
		)
	);

// Behaviour suites: every part of every suite as a public system thing.
// Schemas first in the list so a partial run still leaves the shapes the
// actions reference; data things are stamped with the seeded schema's
// shareId exactly as the executor stamps things it creates.
export const seedDemoSuites = async (): Promise<SeedFail | SeedWebpagesResult> => {
	const definitions: SeedDefinition[] = [];
	for (const suite of BEHAVIOUR_SUITES) {
		const materialized = materializeSuite(suite, 'system');
		const tags = (kind: string) => ['demo', 'suite', suite.key, kind];
		for (const schema of materialized.schemas) {
			definitions.push({ shareId: schema.shareId, uniqueKey: `demo:${schema.shareId}`, kind: 'schema', tags: tags('schema'), crystalInput: schema.crystal });
		}
		for (const component of materialized.components) {
			definitions.push({ shareId: component.shareId, uniqueKey: `demo:${component.shareId}`, kind: 'component', tags: tags('component'), crystalInput: component.crystal });
		}
		for (const action of materialized.actions) {
			definitions.push({ shareId: action.shareId, uniqueKey: `demo:${action.shareId}`, kind: 'action', tags: tags('action'), crystalInput: action.crystal });
		}
		const schemaIdByKey = new Map(materialized.schemas.map((schema) => [schema.key, schema.shareId]));
		for (const entry of materialized.data) {
			definitions.push({
				shareId: entry.shareId,
				uniqueKey: `demo:${entry.shareId}`,
				kind: 'data',
				tags: tags('data'),
				crystalInput: { ...entry.crystal, schemaId: schemaIdByKey.get(entry.schemaKey) }
			});
		}
		definitions.push(webpageDefinition(`${WEBPAGE_DEMO_SLUG_PREFIX}${materialized.page.slug}`, ['webpage', 'demo', 'suite', suite.key], materialized.page.crystal));
	}
	return upsertSystemThings(definitions);
};
