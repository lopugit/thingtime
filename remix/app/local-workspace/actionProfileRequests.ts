import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import { AccountThemeSync } from './accountThemes';
import { AccountAlgorithmSync } from './accountAlgorithms';
import { LocalThemes } from './themes';
import { LocalAlgorithms } from './algorithms';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);
const only = (value: unknown, keys: string[]) => record(value) && Object.keys(value).every(key => keys.includes(key));
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const optionalId = (value: unknown) => value === undefined || identity(value);

// The advertised versions describe this device adapter, not a negotiated remote
// origin. No sync/shared/search route, remote lookup or HTTP fallback is allowed.
const routes = {
	'/api/v1/themes': ['api.themes', '1.1.1'],
	'/api/v1/themes/active': ['api.themes-active', '1.0.0'],
	'/api/v1/themes/delete': ['api.themes-delete', '1.1.1'],
	'/api/v1/algorithms': ['api.algorithms', '1.1.0'],
	'/api/v1/algorithms/update': ['api.algorithms-update', '1.1.0'],
	'/api/v1/algorithms/active': ['api.algorithms-active', '1.1.0'],
	'/api/v1/algorithms/delete': ['api.algorithms-delete', '1.0.1'],
	'/api/v1/algorithms/track': ['api.algorithms-track', '1.0.0']
} as const;

export function localProfileRequestSupported(step: Record<string, unknown>, scope?: WorkspaceScope): boolean {
	// Profiles are home content. A saved step cannot widen the selected account
	// lease, switch databases, or borrow a home worker behind a custom plane.
	if (scope?.kind === 'account' && scope.dataPlane !== 'home') return false;
	const path = String(step.path), contract = routes[path as keyof typeof routes];
	if (!contract || step.feature !== contract[0] || typeof step.minimumVersion !== 'string' ||
		!capabilitySatisfies(contract[1], step.minimumVersion) || (step.query !== undefined && !only(step.query, []))) return false;
	if (step.method === 'GET') return ['/api/v1/themes', '/api/v1/algorithms'].includes(path) && step.body === undefined;
	if (step.method !== 'POST' || !record(step.body)) return false;
	const body = step.body;
	if (path === '/api/v1/themes') return only(body, ['id', 'name', 'theme', 'visibility']) && optionalId(body.id) &&
		(body.visibility === undefined || body.visibility === 'private');
	if (path.endsWith('/delete')) return only(body, ['id']) && identity(body.id);
	if (path === '/api/v1/themes/active') return only(body, ['themeId']) && (body.themeId == null || identity(body.themeId));
	if (path === '/api/v1/algorithms/active') return only(body, ['algorithmId']) && (body.algorithmId == null || identity(body.algorithmId));
	if (path === '/api/v1/algorithms') return only(body, ['name', 'emoji', 'branchFrom', 'description', 'events']) && optionalId(body.branchFrom);
	if (path === '/api/v1/algorithms/update') return only(body, ['id', 'name', 'emoji', 'description']) && identity(body.id);
	// The remote route can infer an active profile. Local training deliberately
	// requires its authored ID rather than silently choosing device/account state.
	return path === '/api/v1/algorithms/track' && only(body, ['algorithmId', 'events']) && identity(body.algorithmId);
}

/** Dedicated writers preserve each profile's protected History, account content
 * intent and selection intent in their existing leased atomic transactions. */
export async function localProfileRequest(db: WorkspaceDatabase, scope: WorkspaceScope, lease: WorkspaceLease, step: Record<string, unknown>): Promise<unknown> {
	lease.assertCurrent();
	if (!localProfileRequestSupported(step, scope)) throw new WorkspaceError('LOCAL_ACTION_REQUEST', 'This profile request has no local adapter', 409);
	const body = (step.body ?? {}) as Record<string, unknown>, path = String(step.path);
	if (path.startsWith('/api/v1/themes')) {
		const account = scope.kind === 'account' ? new AccountThemeSync(db, scope, lease) : null;
		const themes = account?.themes ?? new LocalThemes(db, lease);
		if (step.method === 'GET') return account ? account.list() : themes.list();
		if (path.endsWith('/active')) return themes.setActive(body.themeId == null ? null : body.themeId as string);
		if (path.endsWith('/delete')) return themes.remove(body.id as string);
		return account ? account.save(body) : themes.save(body);
	}
	const account = scope.kind === 'account' ? new AccountAlgorithmSync(db, scope, lease) : null;
	const algorithms = account?.algorithms ?? new LocalAlgorithms(db, lease);
	if (step.method === 'GET') return account ? account.list() : algorithms.list();
	if (path.endsWith('/active')) return algorithms.setActive(body.algorithmId == null ? null : body.algorithmId as string);
	if (path.endsWith('/delete')) return algorithms.remove(body.id as string);
	if (path.endsWith('/track')) return algorithms.track({ algorithmId: body.algorithmId as string, events: body.events });
	const result = path.endsWith('/update') ? await algorithms.update({ ...body, id: body.id as string }) : await algorithms.create(body);
	return account ? { ...result, algorithm: (await account.list()).algorithms.find(row => row.id === result.algorithm.id) } : result;
}
