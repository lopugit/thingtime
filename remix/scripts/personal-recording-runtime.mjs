// Local-only building block for a personally paired recording worker. This is
// not an HTTP server and never accepts or returns Claude OAuth credentials.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_AUDIO = 24 * 1024 * 1024;
const MAX_TEXT = 60_000;
const MAX_WAV = 1200 * 32000 + 4096;
const FORMATS = new Map([
  ['audio/wav', 'wav'], ['audio/x-wav', 'wav'], ['audio/mpeg', 'mp3'],
  ['audio/mp4', 'mov'], ['audio/m4a', 'mov'], ['audio/x-m4a', 'mov'],
  ['video/mp4', 'mov'], ['audio/webm', 'matroska']
]);

// Exclude inherited API keys, endpoint overrides, customizations and proxy
// credentials. Claude Code uses the user's own existing native sign-in.
export const personalRuntimeEnvironment = (source = process.env) => Object.fromEntries(
  ['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL'].filter(key => source[key]).map(key => [key, source[key]])
);

export const parsePersonalCompletion = (stdout) => {
  const envelope = JSON.parse(stdout);
  if (envelope.type !== 'result' || envelope.is_error || envelope.subtype !== 'success' ||
      typeof envelope.result !== 'string' || !envelope.result.trim() || envelope.result.length > MAX_TEXT)
    throw new Error('Personal text processing failed.');
  return envelope.result.trim();
};

// Dependency injection is for unit tests only, not a request-controlled command.
export const createPersonalRecordingRuntime = ({
  claudePath, whisperPath, ffmpegPath, modelPath, execute = exec
}) => {
  for (const path of [claudePath, whisperPath, ffmpegPath, modelPath])
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Configure absolute local runtime paths.');
  const env = personalRuntimeEnvironment();
  const isolated = async (operation) => {
    const cwd = await mkdtemp(join(tmpdir(), 'thingtime-personal-ai-'));
    try { return await operation(cwd); }
    finally { await rm(cwd, { recursive: true, force: true }); }
  };
  return {
    async transcribe({ bytes, type, signal }) {
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_AUDIO || !FORMATS.has(type))
        throw new Error('Unsupported local recording.');
      signal?.throwIfAborted();
      return isolated(async cwd => {
        const input = join(cwd, 'input.audio');
        const wav = join(cwd, 'decoded.wav');
        await writeFile(input, bytes, { mode: 0o600 });
        try {
          await execute(ffmpegPath, [
            '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file',
            '-f', FORMATS.get(type), '-i', input, '-vn', '-ar', '16000', '-ac', '1',
            '-c:a', 'pcm_s16le', '-t', '1201', '-fs', String(MAX_WAV), wav
          ], { cwd, env, signal, timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 });
          // Reject the duration/size ceiling, never silently process a prefix.
          const size = (await stat(wav)).size;
          if (size < 45 || size >= 1200 * 32000) throw new Error('duration');
          const { stdout } = await execute(whisperPath, [
            '-m', modelPath, '-f', wav, '-nt', '-np', '-ng'
          ], { cwd, env, signal, timeout: 180_000, killSignal: 'SIGKILL', maxBuffer: 512 * 1024 });
          const text = stdout.trim();
          if (!text || text.length > MAX_TEXT) throw new Error('transcript');
          signal?.throwIfAborted();
          return text;
        } catch {
          signal?.throwIfAborted();
          throw new Error('Local transcription failed. Check the model, audio format and 20-minute limit.');
        }
      });
    },
    async complete({ system, prompt, signal }) {
      if (typeof system !== 'string' || system.length > 8000 || typeof prompt !== 'string' ||
          !prompt.trim() || prompt.length > MAX_TEXT) throw new Error('Unsupported local text request.');
      signal?.throwIfAborted();
      return isolated(async cwd => {
        try {
          // Verify native Claude-account auth without reading its token. The
          // account identity stays local and is not returned with completions.
          const auth = await execute(claudePath, ['auth', 'status'], {
            cwd, env, signal, timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024
          });
          const status = JSON.parse(auth.stdout);
          if (!status.loggedIn || status.authMethod !== 'claude.ai' || status.apiProvider !== 'firstParty')
            throw new Error('auth');
          // Keep private text out of both the process argument list and files.
          const child = execute(claudePath, [
            '--safe-mode', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
            '--output-format', 'json', '--system-prompt', system, '-p'
          ], { cwd, env, signal, timeout: 90_000, killSignal: 'SIGKILL', maxBuffer: 512 * 1024 });
          // promisified execFile exposes its ChildProcess without a shell.
          child.child.stdin.on('error', () => {});
          child.child.stdin.end(prompt);
          const result = await child;
          signal?.throwIfAborted();
          return parsePersonalCompletion(result.stdout);
        } catch {
          signal?.throwIfAborted();
          throw new Error('Personal Claude Code is unavailable. Check its native sign-in and allowance.');
        }
      });
    }
  };
};
