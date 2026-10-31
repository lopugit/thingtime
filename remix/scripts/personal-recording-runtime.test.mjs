import assert from 'node:assert/strict';
import test from 'node:test';
import { stat, writeFile } from 'node:fs/promises';
import { createPersonalRecordingRuntime, parsePersonalCompletion, personalRuntimeEnvironment } from './personal-recording-runtime.mjs';

const paths = { claudePath: '/runtime/claude', whisperPath: '/runtime/whisper', ffmpegPath: '/runtime/ffmpeg', modelPath: '/models/model.bin' };
const success = { type: 'result', subtype: 'success', is_error: false, result: 'private result' };

test('native runtime excludes inherited credentials, overrides and hooks', () => {
  assert.deepEqual(personalRuntimeEnvironment({ HOME: '/user', PATH: '/bin', ANTHROPIC_API_KEY: 'secret',
    CLAUDE_CODE_OAUTH_TOKEN: 'secret', ANTHROPIC_BASE_URL: 'https://wrong.test', NODE_OPTIONS: '--require evil' }),
  { HOME: '/user', PATH: '/bin' });
  assert.throws(() => createPersonalRecordingRuntime({ ...paths, claudePath: 'claude' }), /absolute/);
  assert.equal(personalRuntimeEnvironment({ USER: 'owner' }).USER, 'owner');
});

test('API-key auth does not qualify as the personal Claude account', async () => {
  let count = 0;
  const runtime = createPersonalRecordingRuntime({ ...paths, execute: async () => {
    count++;
    return { stdout: JSON.stringify({ loggedIn: true, authMethod: 'apiKey', apiProvider: 'firstParty' }) };
  } });
  await assert.rejects(runtime.complete({ system: '', prompt: 'hello' }));
  assert.equal(count, 1);
});

test('decoding duration ceiling rejects rather than transcribing a prefix', async () => {
  let count = 0;
  let cwd;
  const runtime = createPersonalRecordingRuntime({ ...paths, execute: async (_, args, options) => {
    count++; cwd = options.cwd;
    await writeFile(args.at(-1), Buffer.alloc(1200 * 32000));
    return { stdout: '' };
  } });
  await assert.rejects(runtime.transcribe({ bytes: new Uint8Array([1]), type: 'audio/wav' }), /20-minute/);
  assert.equal(count, 1);
  await assert.rejects(stat(cwd), { code: 'ENOENT' });
});

test('only successful bounded native result envelopes are accepted', () => {
  assert.equal(parsePersonalCompletion(JSON.stringify(success)), 'private result');
  for (const bad of [{ ...success, is_error: true }, { ...success, subtype: 'error' },
    { ...success, result: '' }, { ...success, result: 'a'.repeat(60_001) }, { result: 'text' }])
    assert.throws(() => parsePersonalCompletion(JSON.stringify(bad)));
});

test('text uses stdin, disabled tools and isolated cwd; cleanup follows success', async () => {
  const calls = [];
  let stdin;
  const execute = (file, args, options) => {
    calls.push({ file, args, options });
    const result = Promise.resolve({ stdout: JSON.stringify(args[0] === 'auth'
      ? { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' } : success) });
    result.child = { stdin: { on() {}, end(value) { stdin = value; } } };
    return result;
  };
  const value = await createPersonalRecordingRuntime({ ...paths, execute }).complete({ system: 'policy', prompt: 'private transcript' });
  assert.equal(value, 'private result');
  assert.equal(stdin, 'private transcript');
  assert.equal(calls.length, 2);
  assert.ok(!calls[1].args.includes('private transcript'));
  assert.ok(calls[1].args.includes('--safe-mode'));
  assert.equal(calls[1].args[calls[1].args.indexOf('--tools') + 1], '');
  assert.equal(calls[1].options.killSignal, 'SIGKILL');
  assert.equal(calls[1].options.timeout, 90_000);
  await assert.rejects(stat(calls[1].options.cwd), { code: 'ENOENT' });
});

test('auth failures never send a prompt and never expose diagnostics', async () => {
  let cwd;
  let count = 0;
  const runtime = createPersonalRecordingRuntime({ ...paths, execute: async (_, __, options) => {
    count++; cwd = options.cwd; throw new Error('private token raw diagnostics');
  } });
  await assert.rejects(runtime.complete({ system: '', prompt: 'hello' }), error =>
    error.message === 'Personal Claude Code is unavailable. Check its native sign-in and allowance.');
  assert.equal(count, 1);
  await assert.rejects(stat(cwd), { code: 'ENOENT' });
});

test('local audio is bounded, decoded with a fixed demuxer and cleaned up', async () => {
  const calls = [];
  const runtime = createPersonalRecordingRuntime({ ...paths, execute: async (file, args, options) => {
    calls.push({ file, args, options });
    if (file === paths.ffmpegPath) await writeFile(args.at(-1), Buffer.alloc(32044));
    return { stdout: file === paths.whisperPath ? ' transcript ' : '' };
  } });
  assert.equal(await runtime.transcribe({ bytes: new Uint8Array([1]), type: 'audio/mp4' }), 'transcript');
  assert.equal(calls[0].args[calls[0].args.indexOf('-f') + 1], 'mov');
  assert.equal(calls[0].args[calls[0].args.indexOf('-protocol_whitelist') + 1], 'file');
  assert.ok(calls[1].args.includes('-ng'));
  await assert.rejects(stat(calls[0].options.cwd), { code: 'ENOENT' });
  await assert.rejects(runtime.transcribe({ bytes: new Uint8Array([1]), type: 'application/x-mpegURL' }));
  await assert.rejects(runtime.transcribe({ bytes: new Uint8Array(24 * 1024 * 1024 + 1), type: 'audio/wav' }));
  await assert.rejects(runtime.transcribe({ bytes: new Uint8Array([1]), type: 'audio/wav', signal: AbortSignal.abort() }));
  assert.equal(calls.length, 2);
});
