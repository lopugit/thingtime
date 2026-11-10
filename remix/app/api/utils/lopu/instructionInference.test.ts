import assert from 'node:assert/strict';
import test from 'node:test';
import { InstructionInferenceCapacityError, verifyInstructionInferenceCapacity } from './instructionInference';

test('unknown model capacity or absent exact checker refuses before reading retained instructions', async () => {
  let reads = 0;
  const parts = async function* () { reads++; yield { id: 'unused', text: 'must not materialize', enabled: true, start: true, end: true }; };
  for (const modelId of [undefined, 'unknown-provider-model', 'claude-sonnet-4-6']) {
    await assert.rejects(verifyInstructionInferenceCapacity(parts, { modelId }), InstructionInferenceCapacityError);
  }
  assert.equal(reads, 0);
});

test('only the matching verified model checker receives the bounded stream and actual context window', async () => {
  const part = { id: 'one', text: 'Preference', enabled: true, start: true, end: true };
  let reads = 0;
  const parts = async function* () { reads++; yield part; };
  const capacity = { modelId: 'claude-sonnet-4-6', verify: async (stream: AsyncIterable<typeof part>, context: any) => {
    assert.deepEqual(context, { modelId: 'claude-sonnet-4-6', contextWindow: 1000000 });
    for await (const value of stream) assert.deepEqual(value, part);
  } };
  await verifyInstructionInferenceCapacity(parts, { modelId: capacity.modelId, capacity });
  assert.equal(reads, 1);
  await assert.rejects(verifyInstructionInferenceCapacity(parts, { modelId: 'unknown-provider-model', capacity }), InstructionInferenceCapacityError);
  assert.equal(reads, 1);
  await assert.rejects(verifyInstructionInferenceCapacity(parts, { modelId: capacity.modelId, capacity: { ...capacity, verify: async () => { throw Error('Provider context exceeded'); } } }), /Provider context exceeded/);
});

test('ordinary reference-backed saves remain usable without a tokenizer on every prompt surface', async () => {
  const { readInstructionsForInference } = await import('./instructionInference');
  const { splitInstructionParts } = await import('../../../lopu/instructionTransfer');
  const { composeLopuSurfacePrompt } = await import('./promptSettingsCore');
  const { buildLopuSystemPrompt } = await import('./chatPrompt');
  const original = [{ id: 'long', text: '界🙂'.repeat(3000), enabled: true }, { id: 'off', text: 'disabled private text', enabled: false }];
  const instructions = await readInstructionsForInference(async function* () { yield* splitInstructionParts(original); });
  assert.deepEqual(instructions, [original[0]]);
  const settings = { basePrompt: 'Base', instructions };
  for (const protocol of ['native', 'text', 'none'] as const) {
    const prompt = buildLopuSystemPrompt({ viewer: { username: 'owner' }, context: {}, activePage: null, toolProtocol: protocol, promptSettings: settings });
    assert.ok(prompt.text.includes(original[0].text));
    assert.ok(!prompt.text.includes(original[1].text));
  }
  for (const surface of ['Voice', 'Realtime voice', 'Musing', 'Recording insights']) assert.ok(composeLopuSurfacePrompt(settings, surface).includes(original[0].text));
});

test('unverified oversized inference stops at bounded working memory and never clips a successful prompt', async () => {
  const { readInstructionsForInference, LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES } = await import('./instructionInference');
  let yielded = 0;
  const parts = async function* () {
    for (let i = 0; i < 1000000; i++) { yielded++; yield { id: `row_${i}`, text: 'x'.repeat(8000), enabled: true, start: true, end: true }; }
  };
  await assert.rejects(readInstructionsForInference(parts, { modelId: 'claude-sonnet-4-6' }), InstructionInferenceCapacityError);
  assert.ok(yielded < 20);
  assert.ok(yielded * 8000 < LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES + 16000);
});

test('disabled large generations stream without reconstructing disabled text and integrity failures propagate', async () => {
  const { readInstructionsForInference } = await import('./instructionInference');
  const parts = async function* () {
    for (let i = 0; i < 1000; i++) yield { id: `disabled_${i}`, text: 'x'.repeat(8192), enabled: false, start: true, end: true };
    yield { id: 'enabled', text: 'Keep this preference', enabled: true, start: true, end: true };
  };
  assert.deepEqual(await readInstructionsForInference(parts), [{ id: 'enabled', text: 'Keep this preference', enabled: true }]);
  await assert.rejects(readInstructionsForInference(async function* () { yield* parts(); throw Error('Digest changed'); }), /Digest changed/);
});

test('larger inference requires the actual model checker to verify before reconstruction', async () => {
  const { readInstructionsForInference } = await import('./instructionInference');
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `row_${i}`, text: 'x'.repeat(8000), enabled: true, start: true, end: true }));
  let passes = 0, verified = false;
  const parts = async function* () { passes++; if (passes === 3) assert.equal(verified, true); yield* rows; };
  const instructions = await readInstructionsForInference(parts, { modelId: 'claude-sonnet-4-6', capacity: { modelId: 'claude-sonnet-4-6', verify: async stream => {
    let count = 0; for await (const _part of stream) count++; assert.equal(count, rows.length); verified = true;
  } } });
  assert.equal(passes, 3);
  assert.deepEqual(instructions.map(row => row.text), rows.map(row => row.text));
});

test('many short rows within the legacy request budget are not charged transport metadata', async () => {
  const { readInstructionsForInference, LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES } = await import('./instructionInference');
  const { splitInstructionParts } = await import('../../../lopu/instructionTransfer');
  const instructions = Array.from({ length: 1000 }, (_, i) => ({ id: `instruction_${i}`, text: 'a'.repeat(25), enabled: true }));
  const parts = [...splitInstructionParts(instructions)];
  assert.ok(Buffer.byteLength(JSON.stringify({ instructions, expectedRevision: null })) <= LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(parts)) > LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES);
  assert.deepEqual(await readInstructionsForInference(async function* () { yield* parts; }), instructions);
});

test('long fragmented rows use exact logical escaped UTF-8 bytes without repeated row overhead', async () => {
  const { readInstructionsForInference, LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES } = await import('./instructionInference');
  const { splitInstructionParts } = await import('../../../lopu/instructionTransfer');
  const text = '界🙂"\\\n'.repeat(1000) + 'x'.repeat(74000);
  const instructions = [{ id: 'long_row', text, enabled: true }];
  const remaining = LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES - Buffer.byteLength(JSON.stringify(instructions));
  instructions[0].text += 'x'.repeat(remaining);
  const parts = [...splitInstructionParts(instructions)];
  assert.ok(parts.length > 1);
  assert.equal(Buffer.byteLength(JSON.stringify(instructions)), LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(parts)) > LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES);
  assert.deepEqual(await readInstructionsForInference(async function* () { yield* parts; }), instructions);
  const over = [...parts]; over[over.length - 1] = { ...over.at(-1)!, text: over.at(-1)!.text + 'x' };
  await assert.rejects(readInstructionsForInference(async function* () { yield* over; }), InstructionInferenceCapacityError);
});

test('a surrogate pair split across parts is metered as the joined logical Unicode text', async () => {
  const { readInstructionsForInference, LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES } = await import('./instructionInference');
  const row = { id: 'unicode', text: '🙂', enabled: true };
  row.text = 'x'.repeat(LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES - Buffer.byteLength(JSON.stringify([row]))) + row.text;
  const parts = [{ ...row, text: row.text.slice(0, -1), start: true, end: false }, { ...row, text: row.text.slice(-1), start: false, end: true }];
  assert.equal(Buffer.byteLength(JSON.stringify([row])), LEGACY_INSTRUCTION_INFERENCE_WORK_BYTES);
  assert.deepEqual(await readInstructionsForInference(async function* () { yield* parts; }), [row]);
});
