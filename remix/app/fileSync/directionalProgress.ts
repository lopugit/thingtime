import type { SyncOperation } from './execute';
/** Decimal byte counters remain exact beyond JavaScript's cumulative safe range. */
export type SyncDirectionTotal = { operations: number; confirmed: number; bytesTotal: string; bytesConfirmed: string };
export type SyncDirectionalTotals = Record<'upload' | 'download', SyncDirectionTotal>;
export const emptySyncDirections = (): SyncDirectionalTotals => ({ upload: { operations: 0, confirmed: 0, bytesTotal: '0', bytesConfirmed: '0' }, download: { operations: 0, confirmed: 0, bytesTotal: '0', bytesConfirmed: '0' } });
const decimal = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
export function parseSyncDirections(value: unknown): SyncDirectionalTotals {
 const source = value as SyncDirectionalTotals;
 if (!source || !['upload', 'download'].every(direction => {
  const row = source[direction as keyof SyncDirectionalTotals];
  return row && Number.isSafeInteger(row.operations) && row.operations >= 0 && Number.isSafeInteger(row.confirmed) && row.confirmed >= 0 && row.confirmed <= row.operations && decimal(row.bytesTotal) && decimal(row.bytesConfirmed) && BigInt(row.bytesConfirmed) <= BigInt(row.bytesTotal);
 })) throw Error('Invalid directional sync progress.');
 return Object.fromEntries((['upload', 'download'] as const).map(direction => { const row = source[direction]; return [direction, { operations: row.operations, confirmed: row.confirmed, bytesTotal: row.bytesTotal, bytesConfirmed: row.bytesConfirmed }]; })) as SyncDirectionalTotals;
}
export function syncOperationDirection(operation: SyncOperation): 'upload' | 'download' {
 return operation.mutation.kind === 'copy' ? operation.mutation.from === 'local' ? 'upload' : 'download' : operation.mutation.side === 'remote' ? 'upload' : 'download';
}
export function addSyncDirection(totals: SyncDirectionalTotals, operation: SyncOperation, confirmationOnly = false) {
 const row = totals[syncOperationDirection(operation)], bytes = operation.mutation.kind === 'copy' && operation.mutation.source.kind === 'file' ? BigInt(operation.mutation.source.size) : BigInt(0);
 if (!confirmationOnly) { row.operations++; row.bytesTotal = String(BigInt(row.bytesTotal) + bytes); }
 if (confirmationOnly || operation.confirmed) { row.confirmed++; row.bytesConfirmed = String(BigInt(row.bytesConfirmed) + bytes); }
}
export function formatSyncBytes(value: string): string {
 const n = BigInt(value), units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
 let divisor = BigInt(1), unit = 0; while (unit < units.length - 1 && n >= divisor * BigInt(1024)) { divisor *= BigInt(1024); unit++; }
 const tenth = n * BigInt(10) / divisor;
 return `${(tenth / BigInt(10)).toLocaleString()}${tenth % BigInt(10) ? '.' + String(tenth % BigInt(10)) : ''} ${units[unit]}`;
}

export function removeUnconfirmedSyncDirection(totals: SyncDirectionalTotals, operation: SyncOperation) {
 if (operation.confirmed) throw Error('Confirmed progress cannot be removed.');
 const row = totals[syncOperationDirection(operation)], bytes = operation.mutation.kind === 'copy' && operation.mutation.source.kind === 'file' ? BigInt(operation.mutation.source.size) : BigInt(0);
 row.operations--; row.bytesTotal = String(BigInt(row.bytesTotal) - bytes);
}

export function syncRunDirections(operations: readonly SyncOperation[]): SyncDirectionalTotals {
 const totals = emptySyncDirections(); for (const operation of operations) addSyncDirection(totals, operation); return totals;
}

/** Combine disjoint completed and current runs for presentation only. */
export function combineSyncDirections(earlier?: SyncDirectionalTotals, current?: SyncDirectionalTotals): SyncDirectionalTotals | undefined {
 if (!earlier || !current) return earlier ?? current;
 const total = emptySyncDirections();
 for (const key of ['upload', 'download'] as const) {
  const a = earlier[key], b = current[key];
  total[key] = { operations: a.operations + b.operations, confirmed: a.confirmed + b.confirmed,
   bytesTotal: String(BigInt(a.bytesTotal) + BigInt(b.bytesTotal)), bytesConfirmed: String(BigInt(a.bytesConfirmed) + BigInt(b.bytesConfirmed)) };
 }
 return total;
}
