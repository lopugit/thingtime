import { parseThemeHomeContext, type ThemeHomeContext } from './themeHomeContext';
import { createHash } from 'node:crypto';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { readUserThemeSelection, setUserActiveTheme, ActiveThemeConflictError } from '../auth/users';
import { getOwnedTheme, getSharedTheme } from './themes';
import { readTimelineEntries, appendTimelineEvent } from '../timeline/repository';
import { parseTimelineEvent } from '../../../timeline/contract';
import {
	parseThemeSelectionWrite,
	parseThemeSelectionAcknowledgment,
	type ThemeSelectionAcknowledgment,
	type ThemeSelectionWrite
} from './themeSelectionContract';
import { ThemeSyncError } from './themeSync';
const eventId = (writeId: string) => 'theme-selection-' + writeId;
const digest = (ownerId: string, plane: string, command: ThemeSelectionWrite) =>
	createHash('sha256').update(JSON.stringify({ ownerId, plane, command })).digest('hex');
export { readUserThemeSelection };
/** Selection is an independent desired-state write. Theme creation can precede
 * it remotely without delaying the caller's local apply/save completion. */
export async function synchronizeThemeSelection(
	ownerId: string,
	plane: string,
	raw: unknown,
	admit: () => Promise<void>,
	homeContext?: ThemeHomeContext
): Promise<ThemeSelectionAcknowledgment> {
	let command: ThemeSelectionWrite;
	let context: ThemeHomeContext | undefined;
	try {
		command = parseThemeSelectionWrite(raw);
		context = homeContext === undefined ? undefined : parseThemeHomeContext(homeContext);
	} catch {
		throw new ThemeSyncError(400, 'Invalid theme selection command.');
	}
	const things = await getHomeThingsCollection(),
		requestDigest = digest(ownerId, context?.receiptPlane ?? plane, command);
	return withHomeMongoTransaction(async (session) => {
		await admit();
		const entries = await readTimelineEntries(things, ownerId, [eventId(command.writeId)], session);
		if (entries.length) {
			const event = entries[0].event,
				value = event.after?.value as any;
			if (
				entries.length !== 1 ||
				event.id !== eventId(command.writeId) ||
				event.thingId !== ownerId ||
				event.ownerId !== ownerId ||
				event.actorId !== ownerId ||
				event.operationId !== command.writeId ||
				event.source !== 'api' ||
				event.clientId !== null ||
				event.mode !== 'effect' ||
				event.operation !== 'effect' ||
				event.branchId !== 'main' ||
				event.parentIds.length ||
				event.dependencies.length ||
				event.before !== null ||
				event.after?.adapter !== 'theme-selection-receipt' ||
				event.after.version !== 1 ||
				value?.requestDigest !== requestDigest
			)
				throw new ThemeSyncError(409, 'Theme selection request identity changed.');
			const { requestDigest: _, ...result } = value;
			const acknowledgment = parseThemeSelectionAcknowledgment(result);
			if (
				acknowledgment.writeId !== command.writeId ||
				acknowledgment.expectedVersion !== command.expectedVersion ||
				acknowledgment.themeId !== command.themeId
			)
				throw new ThemeSyncError(409, 'Theme selection receipt changed.');
			return acknowledgment;
		}
		if (command.themeId !== null && !(await getOwnedTheme(ownerId, command.themeId, session)) && !(await getSharedTheme(command.themeId, session)))
			throw new ThemeSyncError(404, 'The selected theme is unavailable. Your device choice is preserved.');
		try {
			await setUserActiveTheme(ownerId, command.themeId, { expectedVersion: command.expectedVersion, session });
		} catch (error) {
			if (error instanceof ActiveThemeConflictError) throw new ThemeSyncError(409, error.message);
			throw error;
		}
		const acknowledgment = { ...command, result: await readUserThemeSelection(ownerId, session) };
		await appendTimelineEvent(
			things,
			parseTimelineEvent({
				formatVersion: 1,
				id: eventId(command.writeId),
				ownerId,
				thingId: ownerId,
				branchId: 'main',
				parentIds: [],
				operationId: command.writeId,
				actorId: ownerId,
				source: 'api',
				clientId: null,
				occurredAt: new Date().toISOString(),
				mode: 'effect',
				operation: 'effect',
				label: 'Selected theme',
				before: null,
				after: { adapter: 'theme-selection-receipt', version: 1, value: { ...acknowledgment, requestDigest } },
				dependencies: []
			}),
			session,
			{ plane: 'home' }
		);
		return acknowledgment;
	});
}
