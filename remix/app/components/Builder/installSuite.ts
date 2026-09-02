import { materializeSuite, type BehaviourSuite } from '~/schemas/behaviourSuites';

// Install a behaviour suite into the viewer's own things = the suite's
// OWN-mode bundle created part by part through the ordinary things write
// path, in dependency order: schemas (their ids stamp the data), components,
// actions, data, then the page. The page's controls then run the viewer's
// own actions (the executor resolves delegated clicks owner-only). Shared by
// the gallery's Install button and the run-or-install fallback on seeded
// suite pages and previews, so both surfaces create exactly the same things.

type CreateThing = (payload: Record<string, unknown>) => Promise<any>;

export type InstalledSuite = { pageId: string; actionIds: Record<string, string>; schemaIds: Record<string, string> };

export const installSuite = async (
	create: CreateThing,
	suite: BehaviourSuite,
	options: { seeded?: boolean } = {}
): Promise<InstalledSuite> => {
	const bundle = materializeSuite(suite, 'own');
	const createId = async (payload: Record<string, unknown>): Promise<string> => {
		const resp: any = await create(payload);
		if (!resp?.ok) throw resp;
		return resp?.thing?.id || resp?.id;
	};
	const schemaIds: Record<string, string> = {};
	for (const schema of bundle.schemas) schemaIds[schema.key] = await createId({ thingtime: ['schema'], crystal: schema.crystal, acl: ['tt:user'] });
	for (const component of bundle.components) await createId({ thingtime: ['component'], crystal: component.crystal, acl: ['tt:user'] });
	const actionIds: Record<string, string> = {};
	for (const action of bundle.actions) actionIds[action.key] = await createId({ thingtime: ['action'], crystal: action.crystal, acl: ['tt:user'] });
	for (const entry of bundle.data) {
		await createId({ thingtime: ['data'], crystal: { ...entry.crystal, schemaId: schemaIds[entry.schemaKey] }, acl: ['tt:user'] });
	}
	// App suites (bundle.app) install EVERY page and KEEP each pageKey: that is
	// what makes /p/<pageKey> resolve the viewer's copy ahead of the seeded
	// one, so the app's own links keep working after install. Demo suites
	// still drop the key (their page is a personal copy, not a keyed twin).
	let pageId = '';
	for (const page of bundle.app ? bundle.pages : [bundle.pages[0]]) {
		const { pageKey: _pageKey, ...pageCrystal } = page.crystal as Record<string, unknown> & { pageKey?: string };
		const id = await createId({
			thingtime: ['webpage'],
			crystal: { ...(bundle.app ? page.crystal : pageCrystal), ...(options.seeded ? { forkOf: page.shareId } : {}) },
			acl: ['tt:user']
		});
		if (!pageId) pageId = id;
	}
	return { pageId, actionIds, schemaIds };
};

// The server-side install: one request, idempotent (upserts by key), the
// route every APP suite prefers — see api/utils/webpages/suites.ts. Falls
// back to the client part-by-part install above when the endpoint is
// unavailable (an older deployment), so both paths write the same things.
export type ServerInstalledSuite = {
	ok: true;
	suite: string;
	title: string;
	created: number;
	updated: number;
	pageIds: Record<string, string>;
	entryPageId: string;
	entryPageKey: string;
};

export const installSuiteOnServer = async (key: string): Promise<ServerInstalledSuite> => {
	const response = await fetch('/api/v1/webpages/suites/install', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ key })
	});
	const data = await response.json().catch(() => null);
	if (!response.ok || !data?.ok) throw data || { error: `Install failed (${response.status})` };
	return data as ServerInstalledSuite;
};

// A suite's own-mode actionKeys are `demo-<suite>-<key>`; recover the suite a
// control belongs to from the key it names (longest suite key wins, so
// `demo-orders-place` never matches a hypothetical `order` suite).
export const suiteKeyFromActionKey = (actionKey: string, suites: BehaviourSuite[]): string | null => {
	let best: string | null = null;
	for (const suite of suites) {
		if ((actionKey.startsWith(`demo-${suite.key}-`) || actionKey.startsWith(`app-${suite.key}-`)) && (!best || suite.key.length > best.length)) best = suite.key;
	}
	return best;
};

// The seeded system page's pageKey is `demo-suite-<key>` for the demo suites;
// app suite pages carry crystal.suiteKey directly (suiteKeyOfPage below).
export const suiteKeyFromPageKey = (pageKey: unknown): string | null =>
	typeof pageKey === 'string' && pageKey.startsWith('demo-suite-') ? pageKey.slice('demo-suite-'.length) : null;

export const suiteKeyOfPage = (crystal: { suiteKey?: unknown; pageKey?: unknown } | null | undefined): string | null => {
	if (!crystal) return null;
	if (typeof crystal.suiteKey === 'string' && crystal.suiteKey) return crystal.suiteKey;
	return suiteKeyFromPageKey(crystal.pageKey);
};
