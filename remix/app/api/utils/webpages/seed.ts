import { ensureIndexes, getThingsCollection } from '../mongodb/collections';
import { toBin } from '../auth/users';
import { WEBPAGE_RESERVED_ID_PREFIX } from '../things/things';
import { ACL_ALL, COLLECTION_SCHEMA_VERSIONS, validateThingtimeCrystal } from '~/schemas/registry';
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
	{ key: 'builder', path: '/builder', name: 'Builder' }
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

type SeedFail = { ok: false; status: number; error: string };

const fail = (status: number, error: string): SeedFail => ({ ok: false, status, error });

const genuineSeededWebpage = (twin: any): boolean =>
	!!twin && Array.isArray(twin.thingtime) && twin.thingtime.includes('webpage') && twin.ownerId === 'system';

const seededCount = async (): Promise<number> => {
	const things = await getThingsCollection();
	return things.countDocuments({ thingtime: 'webpage', ownerId: 'system' } as any);
};

export const countSeededWebpages = async (): Promise<{ ok: true; totalSeeded: number }> => ({
	ok: true,
	totalSeeded: await seededCount()
});

export const seedSiteWebpages = async (): Promise<SeedFail | SeedWebpagesResult> => {
	await ensureIndexes();
	const things = await getThingsCollection();
	const notes: string[] = [];
	let created = 0;
	let refreshed = 0;
	let unchanged = 0;
	let skipped = 0;

	const definitions: Array<{ slug: string; crystalInput: Record<string, unknown> }> = [
		...SITE_PAGE_SEEDS.map((seed) => ({
			slug: `route-${seed.key}`,
			crystalInput: {
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
			}
		})),
		{
			slug: SITE_GLOBAL_PAGE_KEY,
			crystalInput: {
				name: 'Global blocks',
				description:
					'Blocks that render on every page and persist across navigation — personalise with the builder.',
				pageKey: SITE_GLOBAL_PAGE_KEY,
				version: 1,
				blocks: []
			}
		}
	];

	for (const def of definitions) {
		const validated = validateThingtimeCrystal(['webpage'], def.crystalInput);
		if (validated.ok === false) {
			notes.push(`skipped ${def.slug}: ${validated.error}`);
			skipped += 1;
			continue;
		}

		const tags = ['webpage', 'site'];
		const shareId = `${WEBPAGE_RESERVED_ID_PREFIX}${def.slug}`;
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
			uniqueKeys: [toBin(`webpage:${def.slug}`)],
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
			if (!genuineSeededWebpage(twin)) {
				notes.push(`skipped ${def.slug}: shareId held by a foreign doc — left unseeded`);
				skipped += 1;
				continue;
			}
			const crystalDrifted = JSON.stringify(twin!.crystal ?? {}) !== JSON.stringify(validated.crystal);
			const tagsDrifted = JSON.stringify(twin!.tags ?? []) !== JSON.stringify(tags);
			const storageDrifted = twin!.storageClass !== 'control';
			if (crystalDrifted || tagsDrifted || storageDrifted) {
				// genuineness lives IN the filter — a foreign doc matches nothing
				await things.updateOne({ shareId, ownerId: 'system', thingtime: 'webpage' } as any, {
					$set: { crystal: validated.crystal, tags, storageClass: 'control', updatedAt: now }
				});
				refreshed += 1;
				continue;
			}
			unchanged += 1;
		} catch (err: any) {
			notes.push(`skipped ${def.slug}: write failed (${err?.codeName || err?.message || 'unknown error'})`);
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
