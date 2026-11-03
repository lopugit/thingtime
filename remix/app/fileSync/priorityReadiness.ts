/** Closed, path-free observations for the existing saved progress surface.
 * Selection is sampled by the scheduler; this is never transfer authority. */
export type FolderBatchGate = 'enabled' | 'not-negotiated' | 'custom-policy';
export type ReservationKind = 'none' | 'operation' | 'file-batch' | 'folder-batch' | 'file-recovery' | 'folder-recovery';
export type PriorityReadiness = {
 folderBatchGate?: FolderBatchGate;
 reservationKind?: ReservationKind;
 reservationRemaining?: number;
 gate: 'enabled' | 'unsupported';
 preferencesCount: number;
 preferencesRevision: number;
 proofCursor: number | null;
 proofCutoff: number | null;
 candidateOrdinal: number | null;
 candidateSequence: number | null;
 blocker: 'none' | 'not-indexed' | 'proof-pending' | 'reserved-or-in-flight' | 'ready';
 measured: boolean;
 reserved: boolean;
};
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
export function parsePriorityReadiness(value: unknown): PriorityReadiness | undefined {
 const p = value as PriorityReadiness | undefined;
 if (!p || !['enabled', 'unsupported'].includes(p.gate) || !count(p.preferencesCount) || !count(p.preferencesRevision) ||
  ![p.proofCursor, p.proofCutoff, p.candidateOrdinal, p.candidateSequence].every(value => value === null || count(value)) ||
  (p.proofCursor === null) !== (p.proofCutoff === null) ||
  (p.proofCursor !== null && p.proofCutoff !== null && p.proofCursor > p.proofCutoff) ||
  (p.candidateOrdinal !== null && (p.candidateOrdinal === 0 || p.candidateOrdinal > p.preferencesCount)) ||
  (p.candidateSequence !== null && p.candidateSequence === 0) || typeof p.measured !== 'boolean' || typeof p.reserved !== 'boolean' ||
  !['none', 'not-indexed', 'proof-pending', 'reserved-or-in-flight', 'ready'].includes(p.blocker)) return undefined;
 const folderBatchGate = ['enabled', 'not-negotiated', 'custom-policy'].includes(p.folderBatchGate ?? '') ? p.folderBatchGate : undefined;
 const kind = p.reservationKind, remaining = p.reservationRemaining;
 const reservation = ['none', 'operation', 'file-batch', 'folder-batch', 'file-recovery', 'folder-recovery'].includes(kind ?? '') && count(remaining) && remaining <= 256 &&
  (kind !== 'none' || remaining === 0) && (kind !== 'operation' || remaining === 1) &&
  (kind === 'none' || kind === 'operation' || remaining >= 1)
  ? { reservationKind: kind, reservationRemaining: remaining } : {};
 return { ...(folderBatchGate ? { folderBatchGate } : {}), ...reservation, gate: p.gate, preferencesCount: p.preferencesCount, preferencesRevision: p.preferencesRevision,
  proofCursor: p.proofCursor, proofCutoff: p.proofCutoff, candidateOrdinal: p.candidateOrdinal,
  candidateSequence: p.candidateSequence, blocker: p.blocker, measured: p.measured, reserved: p.reserved };
}
