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
 return !after.conflict && !instructionSyncBlocked(after) && (after.pending || after.error || after.claim) ? 60_000 : null;
}
