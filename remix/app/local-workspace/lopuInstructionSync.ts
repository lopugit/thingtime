import { instructionSyncBlocked, type InstructionTransport, type LocalLopuInstructions } from './lopuInstructions';

/** One pass of the independent settings worker. Failed initial reads and a
 * claim held by another tab must keep retrying even before a device edit exists.
 * Explicit conflicts wait for review; anonymous settings never use transport. */
export async function syncLopuInstructionPass(
 service: LocalLopuInstructions,
 transport: InstructionTransport,
 signal: AbortSignal,
 changed: () => void,
): Promise<number | null> {
 if (service.scope.kind !== 'account') return null;
 const before = await service.read();
 await service.sync(transport, signal);
 const after = await service.read();
 if (JSON.stringify(before) !== JSON.stringify(after)) changed();
 // An acknowledged earlier save may leave a newer edit ready. It resumes
 // at the normal transfer cadence instead of inheriting the failure retry.
 const cadence = after.pending && !after.attempt && !after.error ? 15_000 : 60_000;
 return !after.conflict && !instructionSyncBlocked(after) && (after.pending || after.error || after.claim) ? Math.max(1_000, (after.retryAt ?? (Date.now() + cadence)) - Date.now()) : null;
}
