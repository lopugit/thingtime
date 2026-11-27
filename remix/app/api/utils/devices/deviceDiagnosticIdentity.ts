import { createHash } from 'node:crypto';
export const debugFolderId = (ownerId: string, origin: string) => 'device-debug-' + createHash('sha256').update(JSON.stringify([ownerId, origin])).digest('hex');
export const isManagedDebugFolder = (row: any): boolean => row?.thingtime?.length === 1 && row.thingtime[0] === 'folder' &&
    row.libraryHidden === true && typeof row.ownerId === 'string' && typeof row.crystal?.debugOrigin === 'string' &&
    row.shareId === debugFolderId(row.ownerId, row.crystal.debugOrigin);
export const isDiagnosticContent = (row: any): boolean => Array.isArray(row?.thingtime) && (row.thingtime.includes('device-diagnostic') ||
    (row.thingtime.length === 1 && row.thingtime[0] === 'folder' && /^device-debug-[a-f0-9]{64}$/.test(row.shareId)));
