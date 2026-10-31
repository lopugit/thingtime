import { getAiModelCatalogEntry } from '../ai/modelsCore';
import type { LopuInstruction } from './promptSettingsCore';
import type { InstructionPart } from '../../../lopu/instructionTransfer';

export class InstructionInferenceCapacityError extends Error {
  readonly code = 'INSTRUCTION_INFERENCE_CAPACITY_UNVERIFIED';
  constructor(readonly modelId: string | null, readonly contextWindow: number | null) {
    super(`Saved instructions were preserved, but ${modelId || 'the selected model'} cannot use this retained instruction generation until its complete prompt capacity can be verified. No instructions were truncated or sent.`);
  }
}
/** Server-only integration seam. The provider adapter must validate the exact
 * complete request (base/system grammar, escaped enabled instructions, history,
 * tools and output reserve), consuming parts without retaining unbounded text.
 * Successful return attests that the immutable generation fits that request.
 * A guessed characters-per-token ratio is not a verified checker. */
export type InstructionInferenceCapacity = {
  modelId: string;
  verify(parts: AsyncIterable<InstructionPart>, context: { modelId: string; contextWindow: number }): Promise<void>;
};
export async function verifyInstructionInferenceCapacity(
  parts: () => AsyncIterable<InstructionPart>,
  options: { modelId?: string; capacity?: InstructionInferenceCapacity } = {}
) {
  const modelId = options.modelId ?? null, contextWindow = getAiModelCatalogEntry(modelId)?.contextWindow ?? null;
  if (!modelId || !contextWindow || options.capacity?.modelId !== modelId)
    throw new InstructionInferenceCapacityError(modelId, contextWindow);
  await options.capacity.verify(parts(), { modelId, contextWindow });
}

// Inference may consume ordinary saved preferences under the same bounded
// working set formerly admitted by the Settings request. This is a transient
// reconstruction budget, never a persisted-content or provider-context limit.
// Provider context errors still surface normally for this compatibility path.
export const LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES = 96 * 1024;

/** Consume immutable parts without reconstructing disabled rows. Crossing the
 * compatibility working set requires a provider-verified complete-request
 * capacity check before a second pass may materialize enabled instructions. */
export async function readInstructionsForInference(
  parts: () => AsyncIterable<InstructionPart>,
  options: { modelId?: string; capacity?: InstructionInferenceCapacity } = {}
): Promise<LopuInstruction[]> {
  const read = async (bounded: boolean) => {
    const rows: LopuInstruction[] = [];
    let pieces: string[] = [], bytes = 2, rowCount = 0, trailingHighSurrogate = false;
    for await (const part of parts()) {
      // Meter logical row JSON, not transport metadata. Every row contributes
      // its identity/checkbox once, bounding disabled-row integrity metadata.
      // Enabled text contributes its exact escaped UTF-8 bytes across fragments.
      if (part.start) {
        bytes += Buffer.byteLength(JSON.stringify({ id: part.id, text: '', enabled: part.enabled })) + (rowCount++ ? 1 : 0);
        trailingHighSurrogate = false;
      }
      if (part.enabled) {
        bytes += Buffer.byteLength(JSON.stringify(part.text)) - 2;
        // A caller may split a UTF-16 pair between transport parts. JSON emits
        // two six-byte escapes separately but four UTF-8 bytes after joining.
        if (trailingHighSurrogate) bytes += /^[\uDC00-\uDFFF]/.test(part.text) ? -2 : 6;
        trailingHighSurrogate = !part.end && /[\uD800-\uDBFF]$/.test(part.text);
        if (trailingHighSurrogate) bytes -= 6;
      }
      if (bounded && bytes > LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES) return null;
      if (!part.enabled) continue;
      if (part.start) { rows.push({ id: part.id, text: '', enabled: true }); pieces = []; }
      pieces.push(part.text);
      if (part.end) rows[rows.length - 1].text = pieces.join('');
    }
    return rows;
  };
  const ordinary = await read(true);
  if (ordinary) return ordinary;
  await verifyInstructionInferenceCapacity(parts, options);
  return (await read(false))!;
}
