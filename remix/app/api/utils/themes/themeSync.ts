import { getHomeThingsCollection, getThemesCollection, withHomeMongoTransaction } from '~/api/utils/mongodb/collections';
import { saveTheme, deleteTheme, toPublicTheme, type ThemeMutationBoundary } from '~/api/utils/themes/themes';
import { readTimelineEntries, appendTimelineEvent } from '~/api/utils/timeline/repository';
import { newThingMutationCapture } from '~/api/utils/timeline/recordMutation';
import { storedSnapshotVersion, storedSnapshotMatch } from '~/api/utils/things/storedSnapshot';
import { parseThemeWrite, THEME_VERSION_PREFIX, type ThemeWriteAcknowledgment } from './themeSyncContract';
import { createThemeWriteReceipt, readThemeWriteReceipt, themeWriteDigest, themeWriteEventId } from './themeSyncReceipt';
import { copyBoundedJson } from '~/utils/boundedJson';
import { MAX_SAVED_THEMES } from '~/theme/savedTheme';

export class ThemeSyncError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}
class ReplayedThemeWrite extends Error {
	constructor(readonly acknowledgment: ThemeWriteAcknowledgment) {
		super('Theme save already completed.');
	}
}
const conflict = (): never => {
	throw new ThemeSyncError(409, 'The account theme changed. Your device changes have been kept.');
};
const themeVersion = (doc: any) => storedSnapshotVersion(doc, THEME_VERSION_PREFIX);
const project = (doc: any, legacy = false) => ({
	...toPublicTheme(
		legacy ? doc : { ...doc, name: doc.crystal?.name, theme: doc.crystal?.theme, visibility: doc.acl?.includes('tt:all') ? 'public' : 'private' }
	),
	folderId: legacy ? null : doc.folderId ?? null,
	version: themeVersion(doc)
});

/** A complete bounded private catalogue, with opaque versions from the actual
 * home-plane documents. A partial result must never imply deletion. */
export async function themeSyncSnapshot(ownerId: string) {
	const things = await getHomeThingsCollection(),
		legacy = await getThemesCollection();
	return withHomeMongoTransaction(async (session) => {
		const current = await things
			.find({ ownerId, thingtime: 'theme' } as any, { session })
			.limit(MAX_SAVED_THEMES + 1)
			.toArray();
		const earlier = await legacy
			.find({ ownerId }, { session })
			.limit(MAX_SAVED_THEMES + 1)
			.toArray();
		if (current.length > MAX_SAVED_THEMES || earlier.length > MAX_SAVED_THEMES)
			throw new ThemeSyncError(413, 'The theme catalogue exceeds the synchronization limit.');
		const all = new Map<string, ReturnType<typeof project>>();
		for (const doc of earlier) all.set(doc.shareId, project(doc, true));
		for (const doc of current) all.set(doc.shareId, project(doc));
		if (all.size > MAX_SAVED_THEMES) throw new ThemeSyncError(413, 'The theme catalogue exceeds the synchronization limit.');
		const sorted = [...all.values()].sort((a, b) => a.id.localeCompare(b.id));
		copyBoundedJson(sorted, { maxBytes: 8 * 1024 * 1024, maxDepth: 12, maxNodes: 250_000 });
		return sorted;
	});
}

/** No alternate theme persistence: these callbacks extend the canonical home
 * writer's own transaction, quota accounting, history and active-pointer cleanup. */
export async function synchronizeThemeWrite(
	ownerId: string,
	selectedPlane: string,
	raw: unknown,
	admit: () => Promise<void>
): Promise<ThemeWriteAcknowledgment> {
	let command;
	try {
		command = parseThemeWrite(raw);
	} catch {
		throw new ThemeSyncError(400, 'Invalid theme synchronization command.');
	}
	if (command.action === 'save' && command.folderId !== undefined && selectedPlane !== 'home' && (command.expectedVersion !== null || command.folderId !== null))
		throw new ThemeSyncError(409, 'Theme folder placement belongs to the home library. Device changes have been kept.');
	const things = await getHomeThingsCollection(),
		legacy = await getThemesCollection();
	const digest = themeWriteDigest(ownerId, selectedPlane, command),
		capture = newThingMutationCapture(ownerId, 'api');
	capture.operationId = command.writeId;
	const replay = async (session?: any) => {
		const entries = await readTimelineEntries(things, ownerId, [themeWriteEventId(command.writeId)], session);
		if (!entries.length) return null;
		if (entries.length !== 1) return conflict();
		try {
			return readThemeWriteReceipt(entries[0].event, ownerId, command, digest);
		} catch {
			return conflict();
		}
	};
	const boundary: ThemeMutationBoundary = {
		createId: command.id,
		...(command.action === 'save' && command.folderId !== undefined ? {folderId:command.folderId} : {}),
		capture,
		beforeWrite: async (before, old, session) => {
			await admit();
			const prior = await replay(session);
			if (prior) throw new ReplayedThemeWrite(prior);
			if (command.expectedVersion === null) {
				if (
					before ||
					old ||
					(await things.findOne({ shareId: command.id } as any, { session, projection: { _id: 1 } })) ||
					(await legacy.findOne({ shareId: command.id }, { session, projection: { _id: 1 } }))
				)
					return conflict();
			} else {
				if (before && old) return conflict();
				const doc = before ?? old;
				if (
					!doc ||
					doc.ownerId !== ownerId ||
					doc.shareId !== command.id ||
					(before && (before.thingtime?.length !== 1 || before.thingtime[0] !== 'theme' || before.appId)) ||
					themeVersion(doc) !== command.expectedVersion
				)
					return conflict();
				const collection = before ? things : legacy;
				if (!(await collection.findOne(storedSnapshotMatch(doc, THEME_VERSION_PREFIX) as any, { session, projection: { _id: 1 } })))
					return conflict();
			}
		},
		afterWrite: async (after, session) => {
			// MongoDB stores _id first. Hash the actual persisted BSON order,
			// not the in-memory insert object, so the next snapshot agrees.
			const stored = after
				? await (Array.isArray(after.thingtime) ? things : legacy).findOne({ _id: after._id, shareId: command.id, ownerId } as any, { session })
				: null;
			if (after && !stored) return conflict();
			const acknowledgment: ThemeWriteAcknowledgment = {
				id: command.id,
				writeId: command.writeId,
				action: command.action,
				expectedVersion: command.expectedVersion,
				resultVersion: stored ? themeVersion(stored) : null
			};
			await appendTimelineEvent(things, createThemeWriteReceipt(ownerId, acknowledgment, digest, capture.now.toISOString()), session, {
				plane: 'home'
			});
		}
	};
	await admit();
	const previous = await replay();
	if (previous) return previous;
	try {
		const result =
			command.action === 'delete'
				? await deleteTheme(ownerId, command.id, boundary)
				: await saveTheme(
						ownerId,
						{
							...(command.expectedVersion === null ? {} : { id: command.id }),
							name: command.name,
							theme: command.theme,
							visibility: command.visibility
						},
						boundary
				  );
		if (result.ok === false) throw new ThemeSyncError(result.status, 'The account theme change was refused. Device changes have been kept.');
		const receipt = await replay();
		if (!receipt) return conflict();
		return receipt;
	} catch (error) {
		if (error instanceof ReplayedThemeWrite) return error.acknowledgment;
		// An exact concurrent request can win before the canonical writer reports a
		// duplicate/CAS failure. Only its protected durable receipt is success.
		const receipt = await replay();
		if (receipt) return receipt;
		throw error;
	}
}
