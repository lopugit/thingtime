import type { RootLoaderData } from '../root-data.server';
import { isDataPlane } from '../utils/dataPlane';

/** Test-fixture boundary for the canonical flat root-data DTO consumed by
 * useCurrentUser/useDataPlane. No alternate identity field or account fallback. */
export function accountSuiteBrowserWorkspace(value: unknown, expectedActor: string): { ownerId: string; dataPlane: string } {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Root data is not an object.');
	const root = value as Partial<Pick<RootLoaderData, 'user' | 'dataPlane'>>;
	if (!root.user || typeof root.user !== 'object' || typeof root.user.id !== 'string' || root.user.temporary === true)
		throw new Error('Root data does not contain an authenticated persistent account.');
	if (root.user.id !== expectedActor) throw new Error('Root data resolved a different effective account.');
	if (!isDataPlane(root.dataPlane)) throw new Error('Root data did not provide a recognized selected data plane.');
	return { ownerId: root.user.id, dataPlane: root.dataPlane };
}

/** Finite observation budget, not a content limit. Nested JSON panes need
 * endpoints and a middle sample; page sampling adapts to large/virtual content. */
export function accountSuiteScrollCheckpoints(maxScroll: number, clientHeight: number, kind: 'page' | 'pane'): number[] {
	if (!Number.isFinite(maxScroll) || !Number.isFinite(clientHeight) || maxScroll < 0 || clientHeight <= 0)
		throw new Error('Invalid suite capture scroll geometry.');
	if (!maxScroll) return [0];
	const segments = kind === 'pane' ? 2 : Math.min(32, Math.max(1, Math.ceil(maxScroll / (clientHeight * 0.8))));
	return Array.from({ length: segments + 1 }, (_, index) => maxScroll * index / segments);
}
