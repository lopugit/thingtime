import { INSTRUCTION_CHAIN_SEED, instructionChainDigest, parseInstructionPart, parseInstructionReference, splitInstructionParts, type InstructionPart } from '../lopu/instructionTransfer';
import { InstructionTransferRetired, instructionSettings, promptSnapshot, type PromptSnapshot, type InstructionState, type InstructionTransfer, type InstructionTransferResult } from './lopuInstructions';
import type { LopuInstructionSettings } from '../api/utils/lopu/promptSettingsCore';
import { WorkspaceError } from './storage';

type Request = (command: unknown) => Promise<any>;
const invalid = () => new WorkspaceError('INVALID_SETTINGS_RECEIPT', 'Account instructions returned an invalid transfer receipt.', 502);
const pause = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
 signal.throwIfAborted();
 const abort = () => { clearTimeout(timer); reject(signal.reason); };
 const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2_500);
 signal.addEventListener('abort', abort, { once: true });
});
/** Fresh changed snapshots stream immutable parts; unchanged remote revisions
 * reuse the scoped durable snapshot instead of downloading it every pass. */
export async function readInstructionSnapshot(request: Request, signal: AbortSignal, known?: PromptSnapshot, attempt?: InstructionState['attempt']): Promise<PromptSnapshot> {
 signal.throwIfAborted();
 const snapshot = await request({ action: 'snapshot' }); signal.throwIfAborted();
 if (!snapshot.personal?.reference) return promptSnapshot(snapshot);
 const reference = parseInstructionReference(snapshot.personal.reference);
 if (known?.personal.revision === snapshot.personal.revision) return promptSnapshot({ base: snapshot.base, personal: known.personal });
 if (attempt?.transfer?.id === reference.attemptId) {
  let digest = INSTRUCTION_CHAIN_SEED, count = 0;
  for (const part of splitInstructionParts(attempt.personal.instructions)) { signal.throwIfAborted(); digest = await instructionChainDigest(digest, part); count++; }
  if (count !== reference.partCount || digest !== reference.digest) throw invalid();
  return promptSnapshot({ base: snapshot.base, personal: { revision: snapshot.personal.revision, instructions: attempt.personal.instructions } });
 }
 let digest = INSTRUCTION_CHAIN_SEED, current: InstructionPart | undefined;
 const instructions: LopuInstructionSettings['instructions'] = [];
 for (let ordinal = 0; ordinal < reference.partCount; ordinal++) {
  // The server's existing rate budget applies to reads too. Reserve room for
  // snapshot/root activity and yield between requests rather than bursting.
  await pause(signal);
  const part = parseInstructionPart((await request({ action: 'read-part', attemptId: reference.attemptId, ordinal })).part); signal.throwIfAborted();
  digest = await instructionChainDigest(digest, part); signal.throwIfAborted();
  if (part.start) { if (current) throw invalid(); current = { ...part }; }
  else { if (!current || current.id !== part.id || current.enabled !== part.enabled) throw invalid(); current.text += part.text; }
  if (part.end) { if (!current) throw invalid(); instructions.push({ id: current.id, text: current.text, enabled: current.enabled }); current = undefined; }
 }
 if (current || digest !== reference.digest) throw invalid();
 return promptSnapshot({ base: snapshot.base, personal: { revision: snapshot.personal.revision, instructions } });
}
/** At most begin + two part batches + commit per pass. The normal worker
 * spaces passes by fifteen seconds, below the existing thirty/minute budget. */
export async function writeInstructionTransfer(request: Request, value: LopuInstructionSettings, transfer: InstructionTransfer, signal: AbortSignal, progress: (transfer: InstructionTransfer) => Promise<void>): Promise<InstructionTransferResult> {
 const canonical = instructionSettings(value);
 let digest = INSTRUCTION_CHAIN_SEED, partCount = 0;
 for (const part of splitInstructionParts(canonical.instructions)) { signal.throwIfAborted(); digest = await instructionChainDigest(digest, part); partCount++; }
 signal.throwIfAborted();
 const inspect = (result: any) => {
  const state = result?.transfer;
  if (!state || state.attemptId !== transfer.id || state.partCount !== partCount || state.digest !== digest || !Number.isSafeInteger(state.nextOrdinal) || state.nextOrdinal < 0 || state.nextOrdinal > partCount || !['staging', 'committed', 'aborted'].includes(state.status)) throw invalid();
  if (state.status === 'aborted') throw new InstructionTransferRetired(transfer.id);
  return state;
 };
 let state = inspect(await request({ action: 'begin', attemptId: transfer.id, expectedRevision: canonical.revision, partCount, digest })); signal.throwIfAborted();
 let checkpoint = { id: transfer.id, nextPart: state.nextOrdinal };
 await progress(checkpoint);
 const receipt = () => ({ transfer: checkpoint, personal: instructionSettings({ revision: state.revision, instructions: canonical.instructions }) });
 if (state.status === 'committed') return receipt();
 const iterator = splitInstructionParts(canonical.instructions);
 for (let skipped = 0; skipped < checkpoint.nextPart; skipped++) iterator.next();
 let pending = iterator.next();
 for (let batch = 0; batch < 2 && !pending.done; batch++) {
  const parts: InstructionPart[] = []; let bytes = 0;
  while (!pending.done && parts.length < 64) {
   const size = new TextEncoder().encode(JSON.stringify(pending.value)).byteLength;
   if (parts.length && bytes + size > 48 * 1024) break;
   parts.push(pending.value); bytes += size; pending = iterator.next();
  }
  state = inspect(await request({ action: 'parts', attemptId: transfer.id, offset: checkpoint.nextPart, parts })); signal.throwIfAborted();
  if (state.nextOrdinal !== checkpoint.nextPart + parts.length) throw invalid();
  checkpoint = { id: transfer.id, nextPart: state.nextOrdinal }; await progress(checkpoint);
 }
 if (checkpoint.nextPart !== partCount) return { transfer: checkpoint };
 state = inspect(await request({ action: 'commit', attemptId: transfer.id })); signal.throwIfAborted();
 if (state.status !== 'committed' || state.revision === canonical.revision) throw invalid();
 return receipt();
}
