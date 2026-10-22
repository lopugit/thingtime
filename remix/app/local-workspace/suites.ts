import { ALL_SUITES } from '../schemas/appSuites';
import { installMaterializedSuite, type SuiteOwnDoc } from '../schemas/suiteInstallation';
import type { LocalThings } from './things';
import { WorkspaceError } from './storage';

/** Bundled, editable definitions only. No remote catalogue or account access. */
export async function installLocalSuite(things: LocalThings, key: string, options: { onlyMissing?: boolean } = {}) {
	if (things.scope.kind !== 'anonymous') throw new WorkspaceError('LOCAL_OPERATION_UNAVAILABLE', 'Account suites require their sync adapter', 409);
	const suite = ALL_SUITES.find((suite) => suite.key === key);
	if (!suite) throw new WorkspaceError('NOT_FOUND', 'This suite is not in the bundled catalogue', 404);
	return things.atomic(async (writer) => {
		const rows = (await writer.snapshot()).sort(
			(a, b) => Number(b.crystal.version || 1) - Number(a.crystal.version || 1) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
		);
		return installMaterializedSuite(
			suite,
			{
				find: async (kind, field, keys) => {
					const selected = new Set(keys),
						found = new Map<string, SuiteOwnDoc>();
					for (const row of rows) {
						const value = row.crystal[field];
						if (row.thingtime.includes(kind) && typeof value === 'string' && selected.has(value) && !found.has(value))
							found.set(value, { shareId: row.id, crystal: row.crystal });
					}
					return found;
				},
				create: async (kind, crystal) => (await writer.create({ thingtime: [kind], crystal })).id,
				update: async (id, crystal) => {
					await writer.update({ id, crystal });
				}
			},
			options
		);
	});
}
