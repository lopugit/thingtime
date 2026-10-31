import { randomUUID } from 'node:crypto';
import { getThingsCollection } from '../mongodb/collections';
import { createThing, updateThing, isFail } from '../things/things';
import { ACL_OWNER } from '~/schemas/registry';
import { authorizeAiWaterfall } from './waterfallService';
import { AI_WATERFALL_SYSTEM_TYPE, parseSavedWaterfallInput, type SavedAiWaterfall } from './savedWaterfallCore';
const filter = (ownerId: string) => ({ ownerId, thingtime: 'data', 'crystal.systemType': AI_WATERFALL_SYSTEM_TYPE });
const project = (doc: any): SavedAiWaterfall =>
	parseSavedWaterfallInput({
		id: doc.shareId,
		name: doc.crystal.name,
		config: doc.crystal.config,
		updatedAt: new Date(doc.updatedAt).toISOString()
	}) as SavedAiWaterfall;
export const listSavedWaterfalls = async (ownerId: string) => {
	const rows = await (await getThingsCollection()).find(filter(ownerId)).sort({ updatedAt: -1 }).limit(200).toArray();
	return rows.flatMap((doc) => {
		try {
			return [project(doc)];
		} catch {
			return [];
		}
	});
};
export const saveWaterfall = async (ownerId: string, value: unknown) => {
	const input = parseSavedWaterfallInput(value);
	// Defaults belong to the legacy global editor; HTTP consumers reject them.
	const entries = input.config.entries.filter((entry) => {
		if (entry.endpointId !== 'default') return true;
		if (entry.modelId !== 'default' || entry.effort !== null || entry.speed !== 'normal') throw new TypeError('Invalid provider default.');
		return false;
	});
	if (entries.length) await authorizeAiWaterfall(ownerId, { version: 1, entries });
	const collection = await getThingsCollection();
	const current = input.id ? await collection.findOne({ ...filter(ownerId), shareId: input.id }) : null;
	if (input.id && !current) return { ok: false as const, status: 404, error: 'Saved waterfall not found.' };
	if (!current && (await collection.countDocuments(filter(ownerId))) >= 200)
		return { ok: false as const, status: 409, error: 'The library holds up to 200 waterfalls. Update an existing one.' };
	const crystal = { systemType: AI_WATERFALL_SYSTEM_TYPE, name: input.name, config: input.config };
	const id = input.id ?? `ai-waterfall-${randomUUID()}`;
	const result = current
		? await updateThing({ id: ownerId }, id, { crystal, acl: [ACL_OWNER] }, { replaceCrystal: true, expectedUpdatedAt: input.updatedAt })
		: await createThing(ownerId, { shareId: id, thingtime: ['data'], crystal, acl: [ACL_OWNER] }, { id: ownerId });
	if (isFail(result))
		return result.status === 409 ? { ...result, error: 'This waterfall changed elsewhere. Close and reopen the editor before saving.' } : result;
	const stored = await collection.findOne({ ...filter(ownerId), shareId: id });
	return { ok: true as const, waterfall: project(stored) };
};
