import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { PersonalPairingState, PersonalPairingStore } from './personal-recording-pair';

const service = 'com.thingtime.personal-recording-worker';
// Write through security's stdin interpreter: credentials never appear in argv,
// shell history, stdout, config files or child-process exception objects.
const security = (args: string[], input?: string): Promise<{ code: number; stdout: string }> => new Promise((resolve, reject) => {
  const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let size = 0; let failed = false;
  const timer = setTimeout(() => { failed = true; child.kill('SIGKILL'); }, 30000);
  const consume = (bytes: Buffer, output: boolean) => {
    size += bytes.length;
    if (size > 65536) { failed = true; child.kill('SIGKILL'); return; }
    if (output) stdout += bytes.toString('utf8');
  };
  child.stdout.on('data', (bytes) => consume(bytes, true));
  child.stderr.on('data', (bytes) => consume(bytes, false));
  child.stdin.on('error', () => {});
  child.once('error', () => { clearTimeout(timer); reject(new Error('The local Keychain is unavailable.')); });
  child.once('close', (code) => {
    clearTimeout(timer);
    if (failed) reject(new Error('The local Keychain did not respond.'));
    else resolve({ code: code ?? 1, stdout });
  });
  child.stdin.end(input);
});

export const createPersonalRecordingKeychain = (origin: string): PersonalPairingStore => {
  if (process.platform !== 'darwin') throw new Error('This launcher currently requires macOS Keychain.');
  const account = createHash('sha256').update(origin).digest('hex');
  const read = async () => {
    const result = await security(['find-generic-password', '-s', service, '-a', account, '-w']);
    if (result.code === 44) return null; // errSecItemNotFound; locked/denied is not absent.
    if (result.code !== 0) throw new Error('Unlock or allow access to the recording worker Keychain item.');
    try {
      const encoded = result.stdout.trim();
      if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
      const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (value.version !== 1 || value.origin !== origin || !/^ttnode_[A-Za-z0-9_-]{43}$/.test(value.credential)) throw new Error();
      return value as PersonalPairingState;
    } catch { throw new Error('The recording worker Keychain item is invalid.'); }
  };
  return { read, async write(value) {
    if (value.origin !== origin) throw new Error('Pairing origin mismatch.');
    const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
    const result = await security(['-i'], `add-generic-password -U -s ${service} -a ${account} -w ${encoded}\n`);
    if (result.code !== 0 || JSON.stringify(await read()) !== JSON.stringify(value))
      throw new Error('Could not verify the recording worker Keychain write.');
  } };
};
