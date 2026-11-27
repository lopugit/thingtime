import { getSettingsCollection } from '../mongodb/collections';
import {
	DEFAULT_AUTOMATION_SWITCHES,
	normalizeAutomationSwitches,
	validateAutomationSwitchChanges,
	type AutomationSwitchState
} from '../../../automation/automationSwitches';

// The `automation-switches` settings singleton:
// { key, switches: { <stored key>: boolean }, updatedAt, updatedBy }.
// Same posture as the Lopu chat defaults store: every read hits the home
// settings collection, so an administrator's change applies on the next
// request; only a failed read serves the last-known-good value, and a cold
// instance during an outage serves all-off.
export const AUTOMATION_SWITCHES_KEY = 'automation-switches';

export type StoredAutomationSwitches = { switches: AutomationSwitchState; updatedAt: string | null; updatedBy: string | null };
type Row = { switches?: unknown; updatedAt?: unknown; updatedBy?: unknown } | null | undefined;

// Switch ids look like `web.timeline`. Mongo update paths split on dots, so the
// first dot is stored as an underscore (`web_timeline`). No surface name has an
// underscore, so the mapping is reversible.
export const idToStoredKey = (id: string) => id.replace('.', '_');
export const storedKeyToId = (key: string) => key.replace('_', '.');

const project = (row: Row): StoredAutomationSwitches => {
	const stored = row?.switches && typeof row.switches === 'object' && !Array.isArray(row.switches) ? (row.switches as Record<string, unknown>) : {};
	return {
		switches: normalizeAutomationSwitches(Object.fromEntries(Object.entries(stored).map(([key, value]) => [storedKeyToId(key), value]))),
		updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : typeof row?.updatedAt === 'string' ? row.updatedAt : null,
		updatedBy: typeof row?.updatedBy === 'string' ? row.updatedBy : null
	};
};

type StoreDependencies = {
	read: () => Promise<Row>;
	/** One atomic `$set` per save. Each switch is its own field, so two
	 * administrators changing different switches never overwrite each other. */
	write: (set: Record<string, unknown>) => Promise<void>;
	now?: () => Date;
};

export const createAutomationSwitchesStore = (dependencies: StoreDependencies) => {
	let lastKnownGood: StoredAutomationSwitches | null = null;
	const readStrict = async () => (lastKnownGood = project(await dependencies.read()));
	const read = async (): Promise<StoredAutomationSwitches> => {
		try {
			return await readStrict();
		} catch {
			return lastKnownGood ?? { switches: DEFAULT_AUTOMATION_SWITCHES, updatedAt: null, updatedBy: null };
		}
	};
	const change = async (value: unknown, updatedBy: string): Promise<StoredAutomationSwitches> => {
		const validated = validateAutomationSwitchChanges(value);
		if (validated.ok === false) throw new TypeError(validated.error);
		const set: Record<string, unknown> = { key: AUTOMATION_SWITCHES_KEY, updatedAt: (dependencies.now ?? (() => new Date()))(), updatedBy };
		for (const [id, enabled] of Object.entries(validated.changes)) set[`switches.${idToStoredKey(id)}`] = enabled;
		await dependencies.write(set);
		return readStrict();
	};
	return { read, readStrict, change };
};

const store = createAutomationSwitchesStore({
	read: async () =>
		(await getSettingsCollection()).findOne({ key: AUTOMATION_SWITCHES_KEY }, { projection: { _id: 0, switches: 1, updatedAt: 1, updatedBy: 1 } }),
	write: async (set) => {
		await (await getSettingsCollection()).updateOne({ key: AUTOMATION_SWITCHES_KEY }, { $set: set }, { upsert: true });
	}
});

/** Lenient read for enforcement: failures serve last-known-good or all-off. */
export const readAutomationSwitches = store.read;
/** Strict read for the admin editor: failures throw. */
export const readAutomationSwitchesStrict = store.readStrict;
export const changeAutomationSwitches = store.change;

export async function automationSwitchEnabled(id: string): Promise<boolean> {
	return (await readAutomationSwitches()).switches[id] === true;
}
