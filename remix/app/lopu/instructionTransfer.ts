import { validateLopuInstructions, validatePromptRevision, type LopuInstruction } from '../api/utils/lopu/promptSettingsCore';

// Transport work units, never limits on the account's instruction content.
export const INSTRUCTION_PART_MAX_BYTES = 48 * 1024;
export const INSTRUCTION_BATCH_PARTS = 64;
export const INSTRUCTION_CHAIN_SEED = '0'.repeat(64);
export const INSTRUCTION_TRANSFER_KIND = 'lopu-instruction-transfer';
export const INSTRUCTION_PART_KIND = 'lopu-instruction-part';
export type InstructionPart = { id: string; enabled: boolean; text: string; start: boolean; end: boolean };
export type InstructionReference = { formatVersion: 1; attemptId: string; partCount: number; digest: string };
export type InstructionRecord = { revision: string | null; instructions: LopuInstruction[] } | { revision: string; reference: InstructionReference };
export type InstructionTransferStatus = { attemptId: string; nextOrdinal: number; partCount: number; digest: string; status: 'staging' | 'committed' | 'aborted'; revision: string };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const instructionOrdinal = (value: unknown): number => {
 if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError('Invalid instruction part position.');
 return Number(value);
};
export const instructionAttemptId = (value: unknown): string => {
 if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new TypeError('Invalid instruction attempt identity.');
 return value;
};
export function parseInstructionReference(value: any): InstructionReference {
 if (!value || value.formatVersion !== 1 || typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest) || Object.keys(value).some(key => !['formatVersion','attemptId','partCount','digest'].includes(key))) throw new TypeError('Invalid instruction reference.');
 return { formatVersion: 1, attemptId: instructionAttemptId(value.attemptId), partCount: instructionOrdinal(value.partCount), digest: value.digest };
}
export function parseInstructionPart(value: any): InstructionPart {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 5 || Object.keys(value).some(key => !['id','enabled','text','start','end'].includes(key)) || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id) || typeof value.enabled !== 'boolean' || typeof value.text !== 'string' || !value.text || typeof value.start !== 'boolean' || typeof value.end !== 'boolean') throw new TypeError('Invalid instruction part.');
 const part = { id: value.id, enabled: value.enabled, text: value.text, start: value.start, end: value.end };
 if (bytes(part) > INSTRUCTION_PART_MAX_BYTES) throw new TypeError('Split this instruction into smaller transport parts.');
 if ((part.start && part.text.trimStart() !== part.text) || (part.end && part.text.trimEnd() !== part.text)) throw new TypeError('Instruction edge whitespace must be normalized before transfer.');
 return part;
}
export function parseInstructionRecord(value: any): InstructionRecord {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid instruction settings.');
 const revision = validatePromptRevision(value.revision);
 if ('reference' in value) {
  if (revision === null || Object.keys(value).length !== 2) throw new TypeError('Invalid retained instruction settings.');
  return { revision, reference: parseInstructionReference(value.reference) };
 }
 return { revision, instructions: validateLopuInstructions(value.instructions) };
}
/** Split after JSON escaping/UTF-8 expansion, retaining complete Unicode pairs. */
export function* splitInstructionParts(value: unknown): Generator<InstructionPart> {
 for (const row of validateLopuInstructions(value)) {
  let offset = 0;
  while (offset < row.text.length) {
   let length = Math.min(6000, row.text.length - offset);
   if (offset + length < row.text.length && /[\uD800-\uDBFF]/.test(row.text[offset + length - 1]) && /[\uDC00-\uDFFF]/.test(row.text[offset + length])) length--;
   const part = { ...row, text: row.text.slice(offset, offset + length), start: offset === 0, end: offset + length === row.text.length };
   yield parseInstructionPart(part); offset += length;
  }
 }
}
export async function instructionChainDigest(previous: string, part: InstructionPart): Promise<string> {
 const data = new TextEncoder().encode(previous + '\n' + JSON.stringify(parseInstructionPart(part)));
 const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
 return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
