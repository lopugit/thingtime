import { bindSuiteComponentRefs } from './suiteComponentBindings';
import type { DemoBlock } from './webpageDemos';
import { materializeSuite, suiteEntryPageKey, suiteSlug, type BehaviourSuite } from './behaviourSuites';
import { validateThingtimeCrystal } from './registry';

// One installation plan for remote accounts and local workspaces. Storage
// adapters retain their own authority, validation, quotas and transactions.
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

export type SuiteOwnDoc = { shareId: string; crystal: Record<string, unknown> };
type OwnDoc = SuiteOwnDoc;
export type SuiteInstallStore = {
	find(kind: string, field: string, keys: string[]): Promise<Map<string, SuiteOwnDoc>>;
	create(kind: string, crystal: Record<string, unknown>): Promise<string>;
	update(id: string, crystal: Record<string, unknown>): Promise<void>;
};
const SAMPLE_STAMP = 'suiteSample';
export async function installMaterializedSuite(
	suite: BehaviourSuite,
	store: SuiteInstallStore,
	options: { onlyMissing?: boolean } = {}
): Promise<InstallSuiteResult> {
	const bundle = materializeSuite(suite, 'own');
	let created = 0;
	let updated = 0;

	const upsert = async (kind: string, existing: OwnDoc | undefined, crystal: Record<string, unknown>): Promise<string> => {
		const checked = validateThingtimeCrystal([kind], crystal);
		if (checked.ok === false) throw new Error(`${kind}: ${checked.error}`);
		crystal = checked.crystal;
		if (existing) {
			if (options.onlyMissing) return existing.shareId;
			// same content → nothing to write; otherwise refresh in place
			if (JSON.stringify(existing.crystal) === JSON.stringify(crystal)) return existing.shareId;
			await store.update(existing.shareId, crystal);
			updated += 1;
			return existing.shareId;
		}
		const id = await store.create(kind, crystal);
		created += 1;
		return id;
	};

	// schemas first — their ids stamp the sample data exactly as the
	// executor stamps things it creates
	const schemaByName = await store.find(
		'schema',
		'name',
		bundle.schemas.map((schema) => schema.crystal.name as string)
	);
	const schemaIds: Record<string, string> = {};
	for (const schema of bundle.schemas) {
		schemaIds[schema.key] = await upsert('schema', schemaByName.get(schema.crystal.name as string), schema.crystal);
	}

	const componentByKey = await store.find(
		'component',
		'componentKey',
		bundle.components.map((component) => component.crystal.componentKey as string)
	);
	const componentIds: Record<string, string> = {};
	for (const component of bundle.components) {
		componentIds[component.key] = await upsert('component', componentByKey.get(component.crystal.componentKey as string), component.crystal);
	}

	const actionByKey = await store.find(
		'action',
		'actionKey',
		bundle.actions.map((action) => action.crystal.actionKey as string)
	);
	const actionIds: Record<string, string> = {};
	for (const action of bundle.actions) {
		actionIds[action.key] = await upsert('action', actionByKey.get(action.crystal.actionKey as string), action.crystal);
	}

	// sample data is seeded ONCE per suite — a viewer's edits to their
	// samples are theirs, and a re-install must never clobber them
	const sampleStamps = bundle.data.map((entry) => `${suite.key}:${entry.index + 1}`);
	const sampleByStamp = await store.find('data', SAMPLE_STAMP, sampleStamps);
	const dataIds: string[] = [];
	for (const entry of bundle.data) {
		const stamp = `${suite.key}:${entry.index + 1}`;
		const existing = sampleByStamp.get(stamp);
		if (existing) {
			dataIds.push(existing.shareId);
			continue;
		}
		const crystal = { ...entry.crystal, schemaId: schemaIds[entry.schemaKey], [SAMPLE_STAMP]: stamp };
		const id = await store.create('data', crystal);
		created += 1;
		dataIds.push(id);
	}

	// pages keep their pageKey: that is what makes /p/<pageKey> resolve the
	// viewer's copy ahead of the seeded one
	const pageByKey = await store.find(
		'webpage',
		'pageKey',
		bundle.pages.map((page) => page.pageKey)
	);
	const pageIds: Record<string, string> = {};
	for (const page of bundle.pages) {
		const bindings = Object.fromEntries(Object.entries(componentIds).map(([key, id]) => [suiteSlug(suite.key, key), id]));
		const crystal = { ...page.crystal, blocks: bindSuiteComponentRefs(page.crystal.blocks as DemoBlock[], bindings), forkOf: page.shareId };
		pageIds[page.key] = await upsert('webpage', pageByKey.get(page.pageKey), crystal);
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
}
