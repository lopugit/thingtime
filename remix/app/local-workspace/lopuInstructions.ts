import { DEFAULT_LOPU_BASE_PROMPT, validateLopuBasePrompt, validateLopuInstructions, validatePromptRevision, type LopuBasePromptSettings, type LopuInstructionSettings } from '../api/utils/lopu/promptSettingsCore';
import { workspaceScopeKey, WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

export type PromptSnapshot = { base: LopuBasePromptSettings; personal: LopuInstructionSettings };
export type InstructionState = PromptSnapshot & {
 remote?: LopuInstructionSettings;
 pending?: boolean;
 attempt?: { personal: LopuInstructionSettings; revision: string | null; transfer?: InstructionTransfer };
 retryAt?: number;
 conflict?: LopuInstructionSettings;
 error?: string;
 claim?: { token: string; until: number };
 blocked?: { revision: string | null };
};
export type InstructionTransfer = { id: string; nextPart: number };
export type InstructionTransferResult = { transfer: InstructionTransfer; personal?: LopuInstructionSettings };
const INSTRUCTION_REQUEST_BYTES = 96 * 1024;
export class InstructionTransferRetired extends WorkspaceError {
 constructor(readonly attemptId: string) { super('INSTRUCTION_TRANSFER_ABORTED', 'This instruction transfer was cancelled or expired. Device instructions have been kept.', 409); }
}
export class InstructionRequestTooLarge extends WorkspaceError {
 constructor() { super('INSTRUCTIONS_REQUEST_TOO_LARGE', 'Instructions are saved on this device. Account sync supports requests up to 96 KiB. Shorten the instructions to retry account sync.', 413); }
}
/** Match the complete atomic HTTP body, including JSON escaping and revision. */
export function serializeInstructionWrite(value: LopuInstructionSettings) {
 const body = JSON.stringify({ scope: 'personal', ...value });
 if (new TextEncoder().encode(body).byteLength > INSTRUCTION_REQUEST_BYTES) throw new InstructionRequestTooLarge();
 return body;
}
export const instructionSyncBlocked = (row: InstructionState) => !!row.blocked &&
 (row.blocked.revision === row.personal.revision || row.blocked.revision === row.attempt?.personal.revision);
export type InstructionTransport = {
 read(signal: AbortSignal, known?: PromptSnapshot, attempt?: InstructionState['attempt'], progress?: () => Promise<void>): Promise<PromptSnapshot>;
 write(value: LopuInstructionSettings, signal: AbortSignal): Promise<LopuInstructionSettings>;
 /** A bounded pass. Persist acknowledged progress before issuing another part. */
 writeResumable?(value: LopuInstructionSettings, transfer: InstructionTransfer, signal: AbortSignal, progress: (transfer: InstructionTransfer) => Promise<void>): Promise<InstructionTransferResult>;
};
const collection = 'lopu-instructions', id = 'personal';
const empty = (): InstructionState => ({ base: { basePrompt: DEFAULT_LOPU_BASE_PROMPT, revision: null }, personal: { revision: null, instructions: [] } });
const same = (a: LopuInstructionSettings['instructions'], b: LopuInstructionSettings['instructions']) => JSON.stringify(a) === JSON.stringify(b);
export const instructionSettings = (value: LopuInstructionSettings): LopuInstructionSettings => ({ revision: validatePromptRevision(value.revision), instructions: validateLopuInstructions(value.instructions) });
export const promptSnapshot = (value: PromptSnapshot): PromptSnapshot => ({ base: { revision: validatePromptRevision(value.base.revision), basePrompt: validateLopuBasePrompt(value.base.basePrompt) }, personal: instructionSettings(value.personal) });

/** Home-pinned preferences use the existing scoped database. A local revision is
 * never a server receipt, and anonymous values never acquire an account queue. */
export class LocalLopuInstructions {
 constructor(readonly db: WorkspaceDatabase, readonly scope: WorkspaceScope, readonly lease: WorkspaceLease, private now = Date.now) { workspaceScopeKey(scope); }
 private transaction<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) {
  return this.db.transaction(this.scope.kind === 'account' ? { ...this.scope, dataPlane: 'home' } : this.scope, mode, this.lease, run);
 }
 private async readIn(tx: WorkspaceTransaction): Promise<InstructionState> {
  const row = await tx.get<InstructionState>(collection, id);
  if (!row) return empty();
  promptSnapshot(row);
  if (row.remote) instructionSettings(row.remote);
  if (row.conflict) instructionSettings(row.conflict);
  if (row.attempt) { instructionSettings(row.attempt.personal); validatePromptRevision(row.attempt.revision); }
  if (row.blocked) validatePromptRevision(row.blocked.revision);
  if (row.attempt?.transfer && (!/^[A-Za-z0-9_-]{1,80}$/.test(row.attempt.transfer.id) || !Number.isSafeInteger(row.attempt.transfer.nextPart) || row.attempt.transfer.nextPart < 0)) throw new WorkspaceError('INVALID_LOCAL_SETTINGS', 'Invalid instruction transfer progress.', 409);
  if (this.scope.kind === 'anonymous' && (row.pending || row.attempt || row.remote || row.claim || row.conflict || row.blocked || row.retryAt))
   throw new WorkspaceError('INVALID_LOCAL_SETTINGS', 'Anonymous instructions cannot contain account sync state.', 409);
  return row;
 }
 read() { return this.transaction('readonly', tx => this.readIn(tx)); }
 save(value: LopuInstructionSettings) {
  const validated = instructionSettings(value);
  return this.transaction('readwrite', async tx => {
   const row = await this.readIn(tx);
   if (row.personal.revision !== validated.revision) throw new WorkspaceError('SETTINGS_CHANGED', 'Instructions changed in another tab. Reload saved settings before saving.', 409);
   const retainedBlock = row.attempt ? row.blocked : undefined;
   const next: InstructionState = { ...row, personal: { instructions: validated.instructions, revision: crypto.randomUUID() }, ...(this.scope.kind === 'account' ? { pending: true } : {}), blocked: retainedBlock, error: retainedBlock ? row.error : undefined };
   await tx.put(collection, id, next); return next;
  });
 }
 /** Choices bind to the exact device and account versions displayed. A newer
  * server edit still has to pass the normal conditional write. */
 resolve(localRevision: string | null, remoteRevision: string | null, choice: 'device' | 'account') {
  return this.transaction('readwrite', async tx => {
   const row = await this.readIn(tx);
   if (this.scope.kind !== 'account' || !row.conflict || row.claim || row.personal.revision !== localRevision || row.conflict.revision !== remoteRevision)
    throw new WorkspaceError('SETTINGS_CHANGED', 'The compared instructions changed. Review them again.', 409);
   const next: InstructionState = { ...row, remote: row.conflict, conflict: undefined, attempt: undefined, blocked: undefined, error: undefined,
    pending: choice === 'device', personal: choice === 'device' ? row.personal : { instructions: row.conflict.instructions, revision: crypto.randomUUID() } };
   await tx.put(collection, id, next); return next;
  });
 }
 async sync(transport: InstructionTransport, signal: AbortSignal) {
  if (this.scope.kind !== 'account') return;
  const active = () => { this.lease.assertCurrent(); signal.throwIfAborted(); };
  active(); const token = crypto.randomUUID();
  const claimed = await this.transaction('readwrite', async tx => {
   const row = await this.readIn(tx);
   // An uncertain legacy attempt may still be reconciled by an explicit wake.
   if (row.conflict || (row.retryAt ?? 0) > this.now() || (instructionSyncBlocked(row) && !row.attempt) || (row.claim?.until ?? 0) > this.now()) return false;
   await tx.put(collection, id, { ...row, claim: { token, until: this.now() + 60_000 } }); return true;
  });
  if (!claimed) return;
  const update = (run: (row: InstructionState) => InstructionState) => this.transaction('readwrite', async tx => {
   const row = await this.readIn(tx); if (row.claim?.token !== token) return null;
   const next = run(row); await tx.put(collection, id, next); return next;
  });
  const acknowledge = (row: InstructionState, remote: LopuInstructionSettings): InstructionState => ({ ...row, remote,
   pending: row.attempt ? row.personal.revision !== row.attempt.personal.revision : false, attempt: undefined, claim: undefined, blocked: undefined, retryAt: undefined, error: undefined });
  let existingAttempt = false;
  try {
   const previous = await this.read();
   const remote = promptSnapshot(await transport.read(signal, previous.remote ? { base: previous.base, personal: previous.remote } : undefined, previous.attempt, async () => { active(); const renewed = await update(row => ({ ...row, claim: { token, until: this.now() + 60_000 } })); if (!renewed) throw new WorkspaceError('SETTINGS_CHANGED', 'Another tab owns this instruction sync.', 409); })); active();
   const ready = await update(row => {
    row = { ...row, base: remote.base };
    if (!row.pending) return { ...row, remote: remote.personal, personal: same(row.personal.instructions, remote.personal.instructions) ? row.personal : { instructions: remote.personal.instructions, revision: crypto.randomUUID() }, claim: undefined, error: undefined };
    // A lost reply needs no second write when the normal GET already proves
    // the same desired state. Preserve any newer device edit beside it.
    if (row.attempt && same(remote.personal.instructions, row.attempt.personal.instructions)) return acknowledge(row, remote.personal);
    const expected = row.attempt ? row.attempt.revision : row.remote?.revision;
    const unobservedEmpty = !row.attempt && !row.remote && remote.personal.instructions.length === 0;
    if (expected !== remote.personal.revision && !unobservedEmpty)
     return { ...row, conflict: remote.personal, claim: undefined, error: undefined };
    existingAttempt = !!row.attempt;
    return { ...row, attempt: row.attempt ?? { personal: row.personal, revision: remote.personal.revision }, error: undefined };
   });
   if (!ready?.claim || !ready.attempt) return;
   active();
   let oversized = false;
   try { serializeInstructionWrite({ instructions: ready.attempt.personal.instructions, revision: ready.attempt.revision }); }
   catch (error) {
    if (!(error instanceof InstructionRequestTooLarge)) throw error;
    if (transport.writeResumable) oversized = true;
    else {
    // A newly frozen attempt has never been sent. Preserve older uncertain
    // attempts until GET proves their receipt; size alone is not that proof.
    await update(row => row.attempt?.personal.revision !== ready.attempt!.personal.revision ? row : {
     ...row, attempt: existingAttempt ? row.attempt : undefined, claim: undefined,
     blocked: existingAttempt || row.personal.revision === ready.attempt!.personal.revision ? { revision: ready.attempt!.personal.revision } : undefined,
     error: existingAttempt ? 'An earlier account save still needs confirmation. Instructions are saved on this device. Account sync supports requests up to 96 KiB; no oversized request was sent again.' : row.personal.revision === ready.attempt!.personal.revision ? error.message : undefined,
    });
    return;
    }
   }
   let result: LopuInstructionSettings;
   if (oversized || ready.attempt.transfer) {
    if (!transport.writeResumable) throw new InstructionRequestTooLarge();
    const transfer = ready.attempt.transfer ?? { id: crypto.randomUUID(), nextPart: 0 };
    const progress = async (next: InstructionTransfer) => {
     active();
     if (next.id !== transfer.id || !Number.isSafeInteger(next.nextPart) || next.nextPart < transfer.nextPart) throw new WorkspaceError('INVALID_SETTINGS_RECEIPT', 'Invalid instruction transfer receipt.', 502);
     const saved = await update(row => ({ ...row, attempt: row.attempt ? { ...row.attempt, transfer: next } : undefined, claim: { token, until: this.now() + 60_000 } }));
     if (!saved?.attempt) throw new WorkspaceError('SETTINGS_CHANGED', 'The instruction transfer changed in another tab.', 409);
    };
    await progress(transfer);
    const resumed = await transport.writeResumable({ instructions: ready.attempt.personal.instructions, revision: ready.attempt.revision }, transfer, signal, progress); active();
    await progress(resumed.transfer);
    if (!resumed.personal) { await update(row => ({ ...row, claim: undefined, retryAt: this.now() + 15_000 })); return; }
    result = resumed.personal;
   } else result = await transport.write({ instructions: ready.attempt.personal.instructions, revision: ready.attempt.revision }, signal);
   const receipt = instructionSettings(result); active();
   if (!same(receipt.instructions, ready.attempt.personal.instructions) || receipt.revision === ready.attempt.revision)
    throw new WorkspaceError('INVALID_SETTINGS_RECEIPT', 'Account instructions returned an unexpected save receipt.', 502);
   await update(row => acknowledge(row, receipt));
  } catch (error) {
   // A retired workspace must not even record an error in its replacement.
   active();
   await update(row => error instanceof InstructionTransferRetired && row.attempt?.transfer?.id === error.attemptId
    // This server tombstone proves the old transfer can never commit. Keep
    // the current device candidate; the next pass reads the account again
    // before freezing a fresh attempt against its observed revision.
    ? { ...row, attempt: undefined, pending: true, claim: undefined, blocked: undefined, retryAt: this.now() + 15_000, error: undefined }
    : error instanceof WorkspaceError && error.code === 'INSTRUCTIONS_RESUMABLE_UNAVAILABLE'
    ? { ...row, attempt: existingAttempt ? row.attempt : undefined, claim: undefined, blocked: { revision: row.attempt?.personal.revision ?? row.personal.revision }, error: error.message }
    : { ...row, claim: undefined, retryAt: row.attempt?.transfer || (error as { retryAfterMs?: number })?.retryAfterMs ? this.now() + Math.max(60_000, Number((error as { retryAfterMs?: number })?.retryAfterMs) || 0) : undefined, error: (error as { status?: number })?.status === 429 ? 'Account sync is waiting for the server request limit. Instructions are saved on this device; sync will retry automatically.' : 'Account sync could not finish. Instructions are saved on this device.' });
  }
 }
}
