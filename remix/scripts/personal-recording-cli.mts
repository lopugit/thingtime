#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createPersonalRecordingRuntime } from './personal-recording-runtime.mjs';
import { createPersonalRecordingWorker } from './personal-recording-worker';
import { createPersonalRecordingKeychain } from './personal-recording-keychain';
import { pairPersonalRecordingDevice, personalRecordingOrigin } from './personal-recording-pair';

const help = `Thingtime personal recording worker (macOS)
  configure --origin https://thingtime.com --claude /absolute/claude --whisper /absolute/whisper-cli --ffmpeg /absolute/ffmpeg --model /absolute/ggml-model.bin
  pair      --origin https://thingtime.com   (paste the one-time secret into the hidden prompt)
  resume    --origin https://thingtime.com   (recover an interrupted pairing)
  status    --origin https://thingtime.com   (local pairing/config only, not provider health)
  run       --origin https://thingtime.com [--once]
Pairing does not opt in. Select this computer and enable processing in /lopu/recordings.
Claude Code uses its own native sign-in. Do not paste Claude/API credentials here.`;

const hiddenSecret = async () => {
  if (!process.stdin.isTTY) throw new Error('Pair from an interactive terminal; do not pass secrets as arguments or files.');
  process.stdout.write('One-time Thingtime pairing secret (hidden): ');
  process.stdin.setRawMode(true); process.stdin.resume();
  let input = ''; let finished = false;
  return new Promise<string>((resolve, reject) => {
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      process.off('SIGTERM', cancel); process.off('SIGINT', cancel);
      process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(input.trim());
    };
    const cancel = () => finish(new Error('Pairing cancelled.'));
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') { finish(new Error('Pairing cancelled.')); return; }
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u007f') input = input.slice(0, -1);
        else if (/^[A-Za-z0-9_-]$/.test(char)) input += char;
        else { finish(new Error('Paste only the one-time Thingtime pairing secret.')); return; }
        if (input.length > 128) { finish(new Error('Pairing secret is too long.')); return; }
      }
    };
    process.stdin.on('data', onData);
    process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  });
};

const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') { console.log(help); return; }
  if (!['configure', 'pair', 'resume', 'status', 'run'].includes(command)) throw new Error('Unknown command. Use --help.');
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--once' && command === 'run') { flags.once = 'true'; continue; }
    if (!['--origin', ...(command === 'configure' ? ['--claude', '--whisper', '--ffmpeg', '--model'] : [])].includes(key) ||
        !args[index + 1] || args[index + 1].startsWith('--') || flags[key.slice(2)]) throw new Error('Invalid options. Use --help.');
    flags[key.slice(2)] = args[++index];
  }
  const origin = personalRecordingOrigin(flags.origin || '');
  const account = createHash('sha256').update(origin).digest('hex');
  const directory = join(homedir(), 'Library', 'Application Support', 'Thingtime', 'recording-worker');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await stat(directory);
  if (info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new Error('The worker setup directory must be owned by you and private (0700).');
  const configPath = join(directory, `${account}.json`);
  const lockPath = join(directory, `${account}.lock`);
  // Fail closed on an existing lock, including stale locks. Never kill another
  // process or automatically steal its Keychain pairing and worker state.
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Another worker/setup holds this origin lock. Stop it first; inspect stale locks manually.'); });
  await lock.writeFile(String(process.pid));
  try {
    const store = createPersonalRecordingKeychain(origin);
    if (command === 'configure') {
      const config = { origin, claudePath: flags.claude, whisperPath: flags.whisper, ffmpegPath: flags.ffmpeg, modelPath: flags.model };
      for (const value of [config.claudePath, config.whisperPath, config.ffmpegPath, config.modelPath]) {
        if (!value || !isAbsolute(value) || !(await stat(value)).isFile()) throw new Error('Choose existing absolute runtime and model file paths.');
      }
      const temporary = `${configPath}.new`;
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(config)); } finally { await file.close(); }
      await rename(temporary, configPath);
      console.log('Runtime paths saved locally. No credentials were saved in the config.');
    } else if (command === 'pair' || command === 'resume') {
      const existing = await store.read();
      const pairingSecret = command === 'pair' && !existing ? await hiddenSecret() : undefined;
      if (command === 'resume' && !existing) throw new Error('No interrupted pairing exists; use pair.');
      const result = await pairPersonalRecordingDevice({ origin, pairingSecret, store });
      console.log(`Paired computer ${result.deviceId}. Select it in ${origin}/lopu/recordings and enable processing when ready.`);
    } else {
      const state = await store.read();
      const config = await readFile(configPath, 'utf8').then(JSON.parse).catch((error: { code?: string }) => {
        if (error.code === 'ENOENT') return null;
        throw new Error('Cannot read the runtime configuration.');
      });
      if (config && config.origin !== origin) throw new Error('Runtime configuration origin mismatch.');
      if (command === 'status') {
        console.log(JSON.stringify({ origin, paired: Boolean(state?.deviceId), pendingPairing: Boolean(state?.pending), configured: Boolean(config) }));
        return;
      }
      if (!config) throw new Error('Configure the local runtime first.');
      if (!state?.deviceId) throw new Error('Pair this worker first.');
      const worker = createPersonalRecordingWorker({ origin, credential: state.credential, runtime: createPersonalRecordingRuntime(config) });
      const stop = new AbortController();
      const abort = () => stop.abort(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
      let failures = 0; let previous = '';
      try {
        do {
          try {
            const result = await worker.runOnce({ signal: stop.signal }); failures = 0;
            if (result.status !== previous || result.status === 'done') console.log(`Recording worker: ${result.status}.`);
            previous = result.status;
          } catch {
            if (stop.signal.aborted) break;
            failures++; console.error('Recording worker needs attention: check selection, consent, connection and local runtime.');
            if (flags.once || failures >= 3) throw new Error('Recording worker stopped after failed checks. No automatic restart.');
          }
          if (flags.once) break;
          await sleep(30000 * Math.max(1, failures), undefined, { signal: stop.signal });
        } while (!stop.signal.aborted);
      } catch (error) { if (!stop.signal.aborted) throw error; }
      finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
    }
  } finally { await lock.close(); await unlink(lockPath); }
};
main().catch(() => { console.error('Recording worker command failed. Check setup, Keychain access, pairing and account consent; use --help. No credentials were printed.'); process.exitCode = 1; });
