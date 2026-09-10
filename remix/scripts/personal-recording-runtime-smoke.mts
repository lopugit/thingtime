// Explicit opt-in: synthetic local audio only; optionally consumes native Claude allowance.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createPersonalRecordingRuntime, personalRuntimeEnvironment } from './personal-recording-runtime.mjs';
import { parseRecordingInsights, RECORDING_INSIGHTS_PROMPT } from '../app/api/utils/lopu/recordingsCore';

const main = async () => {
  if (process.env.TT_PERSONAL_RUNTIME_SMOKE !== '1') {
    console.log('Skipped: set TT_PERSONAL_RUNTIME_SMOKE=1 and absolute TT_SMOKE_CLAUDE, TT_SMOKE_WHISPER, TT_SMOKE_FFMPEG, TT_SMOKE_MODEL paths. Set TT_PERSONAL_CLAUDE_SMOKE=1 to also test native text analysis.');
    return;
  }
  const paths = { claudePath: process.env.TT_SMOKE_CLAUDE, whisperPath: process.env.TT_SMOKE_WHISPER,
    ffmpegPath: process.env.TT_SMOKE_FFMPEG, modelPath: process.env.TT_SMOKE_MODEL };
  const runtime = createPersonalRecordingRuntime(paths);
  if (typeof paths.ffmpegPath !== 'string') throw new Error('Configure ffmpeg.');
  const execute = promisify(execFile);
  const cwd = await mkdtemp(join(tmpdir(), 'thingtime-synthetic-recording-'));
  const signal = AbortSignal.timeout(300_000);
  const options = { cwd, env: personalRuntimeEnvironment(), signal, timeout: 30_000, maxBuffer: 64 * 1024 };
  try {
    const source = join(cwd, 'synthetic.aiff');
    const wav = join(cwd, 'synthetic.wav');
    const m4a = join(cwd, 'synthetic.m4a');
    await execute('/usr/bin/say', ['-v', 'Samantha', '-r', '150', '-o', source,
      'Please remind me to water the garden tomorrow. My new notebook has a blue cover. Keep that as a note.'], options);
    await execute(paths.ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', source,
      '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], options);
    await execute(paths.ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', source,
      '-c:a', 'aac', m4a], options);
    let transcript = '';
    for (const [path, type] of [[wav, 'audio/wav'], [m4a, 'audio/mp4']]) {
      transcript = await runtime.transcribe({ bytes: await readFile(path), type, signal });
      assert.match(transcript, /water the garden/i);
      assert.match(transcript, /blue cover/i);
      console.log(`PASS: synthetic ${type} decoded and transcribed locally.`);
    }
    if (process.env.TT_PERSONAL_CLAUDE_SMOKE === '1') {
      const output = await runtime.complete({ system: RECORDING_INSIGHTS_PROMPT, prompt: transcript, signal });
      const items = parseRecordingInsights(output, transcript);
      assert.ok(items.some(item => item.kind === 'todo' && /garden/i.test(`${item.title} ${item.description}`)));
      assert.ok(items.some(item => item.kind === 'note' && /blue|notebook/i.test(`${item.title} ${item.description}`)));
      console.log('PASS: native Claude OAuth returned evidence-backed todo and note data from transcript text.');
    } else console.log('Native Claude text analysis skipped (separate opt-in).');
    console.log('No Thingtime account, recording, reminder, or private data was created or changed.');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
};
main().catch(() => {
  // Never print provider output, inherited env, raw child diagnostics or credentials.
  console.error('Synthetic runtime smoke failed. Check local executables/model and native Claude sign-in/allowance.');
  process.exitCode = 1;
});
