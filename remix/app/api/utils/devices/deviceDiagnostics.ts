import { createHash } from 'node:crypto';
import { getHomeThingsCollection, getSessionsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { insertAccountedThing, updateAccountedThing, deleteAccountedThings } from '../storage/accountedThings';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { normalizeDeviceDiagnostic, diagnosticId, DIAGNOSTIC_LEVELS, DIAGNOSTIC_CATEGORIES, type DeviceDiagnosticInput } from '~/devices/deviceDiagnostics';
import type { DeviceActor } from './deviceAuth';
import { DeviceObservationFailure } from './deviceObservations';
import { thingUniqueKey } from '../mongodb/uniqueKeys';
import { debugFolderId } from './deviceDiagnosticIdentity';
export { debugFolderId } from './deviceDiagnosticIdentity';

export const DEVICE_DIAGNOSTIC_KIND = 'device-diagnostic';
const HOME = { accountedPlane: 'home' as const };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status: number, code: string, message: string): never => { throw new DeviceObservationFailure(status, code, message); };
const privateRow = (row: any, ownerId: string) => row?.ownerId === ownerId && row.appId == null && row.sandbox == null && row.sandboxSpace == null && row.acl?.length === 1 && row.acl[0] === 'tt:user';
const publicFolder = (row: any) => row ? { id: row.shareId, name: 'Debug', hidden: true as const } : null;
const publicEvent = (row: any) => ({ ...row.crystal.event, id: row.shareId, deviceId: row.crystal.deviceId, receivedAt: row.createdAt.toISOString() });
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
type Dependencies = {
    things(): Promise<any>; sessions(): Promise<any>; transaction<T>(work: (session: any) => Promise<T>): Promise<T>;
    insert: typeof insertAccountedThing; update: typeof updateAccountedThing; remove: typeof deleteAccountedThings;
    customPlane(): boolean; now(): Date;
};
const defaults: Dependencies = { things: getHomeThingsCollection, sessions: getSessionsCollection, transaction: withHomeMongoTransaction,
    insert: insertAccountedThing, update: updateAccountedThing, remove: deleteAccountedThings, customPlane: isCustomMongoEndpointActive, now: () => new Date() };
export function createDeviceDiagnosticsService(overrides: Partial<Dependencies> = {}) {
    const deps = { ...defaults, ...overrides };
    const plane = () => { if (deps.customPlane()) fail(409, 'DATA_PLANE_CHANGED', 'Device diagnostics require the selected home data plane'); };
    const folder = async (ownerId: string, origin: string, session?: any, ensure = false): Promise<any> => {
        const things = await deps.things(), id = debugFolderId(ownerId, origin), key = thingUniqueKey('defaultFolder', hash([ownerId, origin, 'debug']));
        const row = await things.findOne({ shareId: id }, { session });
        if (row) {
            if (!privateRow(row, ownerId) || row.thingtime?.length !== 1 || row.thingtime[0] !== 'folder' || row.libraryHidden !== true || row.crystal?.debugOrigin !== origin || row.folderId != null ||
                !row.uniqueKeys?.some((value: any) => Buffer.from(value.buffer).equals(Buffer.from(key.buffer))))
                fail(409, 'DEBUG_FOLDER_CHANGED', 'The private Debug folder identity changed');
            return row;
        }
        if (!ensure) return null;
        const now = deps.now();
        const doc = { shareId: id, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: ['folder'], ownerId, acl: ['tt:user'],
            folderId: null, targetId: null, libraryHidden: true, uniqueKeys: [key],
            crystal: { name: 'Debug', debugOrigin: origin, diagnosticsEnabled: true }, tags: [], createdAt: now, updatedAt: now };
        await deps.insert(things, doc, { ...HOME, session });
        return doc;
    };
    const transact = async <T>(work: (session: any) => Promise<T>): Promise<T> => {
        plane();
        try { return await deps.transaction(work); }
        catch (error) {
            // A concurrent immutable identity insert may win. Re-read it in a
            // fresh transaction; every authority and payload check runs again.
            if ((error as any)?.code !== 11000) throw error;
            return deps.transaction(work);
        }
    };
    const ensure = (ownerId: string, origin: string) => transact(async session => {
        const row = await folder(ownerId, origin, session, true);
        return { ok: true as const, folder: publicFolder(row), settings: { enabled: row.crystal.diagnosticsEnabled !== false } };
    });
    const actorFence = async (actor: DeviceActor, session: any) => {
        const now = deps.now();
        const result = await (await deps.sessions()).updateOne({ jti: actor.sessionId, userId: actor.userId, purpose: 'device',
            'meta.deviceId': actor.deviceId, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
            { $set: { 'meta.diagnosticsCheckedAt': now } }, { session });
        if (!result.matchedCount) fail(401, 'DEVICE_REVOKED', 'Unauthorized device credential');
        const device = await (await deps.things()).findOne({ shareId: actor.deviceId, ownerId: actor.userId, thingtime: 'device' }, { session });
        if (!device) fail(401, 'DEVICE_REVOKED', 'Paired device not found');
    };
    const node = (actor: DeviceActor, origin: string, raw: Record<string, unknown>) => transact(async session => {
        if (!raw || !['status', 'append'].includes(String(raw.action)) || Object.keys(raw).some(key => !['action', ...(raw.action === 'append' ? ['events'] : [])].includes(key)))
            fail(400, 'INVALID_DIAGNOSTIC', 'Use a registered diagnostic operation');
        const events = raw.action === 'append' ? raw.events : [];
        if (!Array.isArray(events) || events.length > 32) fail(413, 'DIAGNOSTIC_BATCH', 'Split diagnostic events into smaller processing batches');
        const normalized = (events as unknown[]).map(value => normalizeDeviceDiagnostic(value, deps.now().getTime()));
        if (normalized.some(value => !value) || new Set(normalized.map(value => value!.eventId)).size !== normalized.length)
            fail(400, 'INVALID_DIAGNOSTIC', 'Diagnostic fields must match the safe registered contract');
        await actorFence(actor, session);
        const root = await folder(actor.userId, origin, session, true), enabled = root.crystal.diagnosticsEnabled !== false;
        if (raw.action === 'status') return { ok: true as const, enabled, folderId: root.shareId };
        if (!enabled) return { ok: true as const, enabled: false, folderId: root.shareId, acknowledgedEventIds: [] };
        const things = await deps.things();
        // Serialize with opt-out, clear and generic folder deletion in this
        // same home transaction; this field is never an array of events.
        const fence = await deps.update(things, { _id: root._id, shareId: root.shareId, ownerId: actor.userId },
            { $set: { 'crystal.diagnosticsCheckedAt': deps.now() } }, { ...HOME, session });
        if (!fence.matchedCount) fail(409, 'DEBUG_FOLDER_CHANGED', 'The private Debug folder changed');
        const acknowledgedEventIds: string[] = [];
        let sequence = root.crystal.diagnosticSequence ?? 0;
        if (!Number.isSafeInteger(sequence) || sequence < 0) fail(409, 'DIAGNOSTIC_SEQUENCE_CHANGED', 'Diagnostic sequence is unavailable');
        for (const event of normalized as DeviceDiagnosticInput[]) {
            if (event.configurationId) {
                const configuration = await things.findOne({ shareId: event.configurationId, ownerId: actor.userId, thingtime: 'file-sync',
                    'crystal.deviceId': actor.deviceId }, { session });
                if (!configuration) fail(403, 'DIAGNOSTIC_CONFIGURATION', 'The configuration does not belong to this paired device');
            }
            const id = 'device-diagnostic-' + hash([actor.userId, origin, actor.deviceId, event.eventId]);
            const payloadHash = hash(canonical(event));
            const old = await things.findOne({ shareId: id }, { session });
            if (old) {
                if (!privateRow(old, actor.userId) || old.thingtime?.length !== 1 || old.thingtime[0] !== DEVICE_DIAGNOSTIC_KIND || old.folderId !== root.shareId || old.crystal?.deviceId !== actor.deviceId || old.crystal?.payloadHash !== payloadHash)
                    fail(409, 'DIAGNOSTIC_CONFLICT', 'This diagnostic identity already has different content');
            } else {
                sequence++;
                if (!Number.isSafeInteger(sequence)) fail(409, 'DIAGNOSTIC_SEQUENCE_CHANGED', 'Diagnostic sequence is unavailable');
                const now = deps.now();
                await deps.insert(things, { shareId: id, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: [DEVICE_DIAGNOSTIC_KIND],
                    ownerId: actor.userId, acl: ['tt:user'], folderId: root.shareId, targetId: root.shareId,
                    uniqueKeys: [thingUniqueKey('deviceDiagnostic', id)],
                    crystal: { event, deviceId: actor.deviceId, payloadHash, sequence, renderComponent: { name: 'Diagnostic event', library: 'custom', category: 'general', render: { tag: 'p', children: ['{event.code}'] } } },
                    tags: [], createdAt: now, updatedAt: now }, { ...HOME, session });
            }
            acknowledgedEventIds.push(event.eventId);
        }
        if (sequence !== (root.crystal.diagnosticSequence ?? 0)) await deps.update(things, { _id: root._id, ownerId: actor.userId },
            { $set: { 'crystal.diagnosticSequence': sequence } }, { ...HOME, session });
        return { ok: true as const, enabled: true, folderId: root.shareId, acknowledgedEventIds };
    });
    const read = async (ownerId: string, origin: string, raw: Record<string, unknown>) => {
        plane();
        if (Object.keys(raw).some(key => !['cursor', 'deviceId', 'level', 'category', 'limit'].includes(key)) ||
            (raw.deviceId !== undefined && !diagnosticId(raw.deviceId)) ||
            (raw.level !== undefined && !DIAGNOSTIC_LEVELS.includes(raw.level as any)) ||
            (raw.category !== undefined && !DIAGNOSTIC_CATEGORIES.includes(raw.category as any))) fail(400, 'INVALID_DIAGNOSTIC_QUERY', 'Invalid diagnostic filters');
        const limit = raw.limit === undefined ? 50 : Number(raw.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail(400, 'INVALID_DIAGNOSTIC_QUERY', 'Use a diagnostic processing page of1 to100');
        const filters = { ownerId, origin, deviceId: raw.deviceId, level: raw.level, category: raw.category };
        let after: any;
        if (raw.cursor !== undefined) {
            try {
                if (typeof raw.cursor !== 'string' || raw.cursor.length > 2048) throw Error();
                after = JSON.parse(Buffer.from(raw.cursor, 'base64url').toString('utf8'));
                if (!after || after.scope !== hash(filters) || !diagnosticId(after.id) || typeof after.at !== 'string' || new Date(after.at).toISOString() !== after.at ||
                    !Number.isSafeInteger(after.throughSequence) || after.throughSequence < 0) throw Error();
            } catch { fail(400, 'INVALID_DIAGNOSTIC_CURSOR', 'The diagnostic page cursor is unavailable'); }
        }
        const root = await folder(ownerId, origin);
        if (!root) return { ok: true as const, folder: null, settings: { enabled: true }, events: [], nextCursor: null, throughSequence: 0 };
        const throughSequence = after?.throughSequence ?? root.crystal.diagnosticSequence ?? 0;
        if (!Number.isSafeInteger(throughSequence) || throughSequence < 0 || throughSequence > (root.crystal.diagnosticSequence ?? 0))
            fail(400, 'INVALID_DIAGNOSTIC_CURSOR', 'The diagnostic watermark is unavailable');
        const rows = await (await deps.things()).find({ ownerId, thingtime: DEVICE_DIAGNOSTIC_KIND, folderId: root.shareId,
            'crystal.sequence': { $lte: throughSequence },
            ...(raw.deviceId ? { 'crystal.deviceId': raw.deviceId } : {}), ...(raw.level ? { 'crystal.event.level': raw.level } : {}),
            ...(raw.category ? { 'crystal.event.category': raw.category } : {}),
            ...(after ? { $or: [{ createdAt: { $lt: new Date(after.at) } }, { createdAt: new Date(after.at), shareId: { $gt: after.id } }] } : {})
        }).sort({ createdAt: -1, shareId: 1 }).limit(limit + 1).toArray();
        if (rows.some((row: any) => !privateRow(row, ownerId))) fail(409, 'DIAGNOSTIC_AUDIENCE_CHANGED', 'Diagnostic privacy changed');
        const page = rows.slice(0, limit), last = page.at(-1);
        return { ok: true as const, folder: publicFolder(root), settings: { enabled: root.crystal.diagnosticsEnabled !== false }, events: page.map(publicEvent), throughSequence,
            nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ scope: hash(filters), id: last.shareId, at: last.createdAt.toISOString(), throughSequence })).toString('base64url') : null };
    };
    const owner = (ownerId: string, origin: string, raw: Record<string, unknown>) => transact(async session => {
        if (!raw || !['ensure', 'settings', 'clear'].includes(String(raw.action)) || Object.keys(raw).some(key => !['action', ...(raw.action === 'settings' ? ['enabled'] : []), ...(raw.action === 'clear' ? ['requestId', 'throughSequence'] : [])].includes(key)) ||
            (raw.action === 'settings' && typeof raw.enabled !== 'boolean') ||
            (raw.action === 'clear' && (typeof raw.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(raw.requestId) ||
                !Number.isSafeInteger(raw.throughSequence) || Number(raw.throughSequence) < 0))) fail(400, 'INVALID_DIAGNOSTIC_OPERATION', 'Invalid diagnostics operation');
        const root = await folder(ownerId, origin, session, true), things = await deps.things();
        if (raw.action === 'clear') {
            const throughSequence = raw.throughSequence as number;
            if (throughSequence > (root.crystal.diagnosticSequence ?? 0)) fail(409, 'DIAGNOSTIC_SEQUENCE_CHANGED', 'Diagnostic watermark is unavailable');
            await deps.update(things, { _id: root._id, ownerId }, { $set: { 'crystal.diagnosticsCheckedAt': deps.now() } }, { ...HOME, session });
            const rows = await things.find({ ownerId, thingtime: DEVICE_DIAGNOSTIC_KIND, folderId: root.shareId,
                'crystal.sequence': { $lte: throughSequence } }, { session }).sort({ createdAt: 1, shareId: 1 }).limit(101).toArray();
            const batch = rows.slice(0, 100);
            if (batch.length) await deps.remove(things, { ownerId, thingtime: DEVICE_DIAGNOSTIC_KIND, _id: { $in: batch.map((row: any) => row._id) } }, { ...HOME, session });
            return { ok: true as const, requestId: raw.requestId, throughSequence, deleted: batch.length, hasMore: rows.length > batch.length };
        }
        if (raw.action === 'settings') await deps.update(things, { _id: root._id, ownerId }, { $set: { 'crystal.diagnosticsEnabled': raw.enabled } }, { ...HOME, session });
        return { ok: true as const, folder: publicFolder(root), settings: { enabled: raw.action === 'settings' ? raw.enabled as boolean : root.crystal.diagnosticsEnabled !== false } };
    });
    return { ensure, node, read, owner };
}
export const deviceDiagnostics = createDeviceDiagnosticsService();
