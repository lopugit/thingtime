import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import contract from './release.cjs';
import inventory from './inventory.cjs';
import { releaseAssetNames, writeReleaseArchive, fileDigest } from './archive.mjs';
const { canonical, releaseId, signDescriptor, verifyEnvelope } = contract;
const { inventoryDirectory, verifyDirectory } = inventory;

// No network or archive extraction. The verified immutable output includes a
// deterministic stored ZIP for the canonical release publisher and API ranges.
export async function packageRelease({ source, output, metadata, keyId, privateKey, trustedKeys }) {
  source = path.resolve(source); output = path.resolve(output);
  const relative = path.relative(source, output);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Release output must be outside its source');
  const files = await inventoryDirectory(source);
  const built = JSON.parse(await readFile(path.join(source, 'metadata.json'), 'utf8')).nativeBundle;
  if (!built || canonical(built.target) !== canonical(metadata.target) || canonical(built.entrypoints) !== canonical(metadata.entrypoints) ||
      built.runtime.id !== metadata.runtime.id || built.runtime.nativeAbi !== metadata.runtime.nativeAbi) throw new Error('Release compatibility differs from the actual build');
  contract.assertCompatible({ ...metadata, files }, { platform: built.target.platform, arch: built.target.arch, runtimeId: built.runtime.id,
    nativeAbi: built.runtime.nativeAbi, shellVersion: built.runtime.shellVersion, channel: metadata.channel, minimumSequence: metadata.sequence });
  const descriptor = { ...metadata, files };
  const envelope = signDescriptor(descriptor, { keyId, privateKey });
  // Verify the selected signer against independently supplied policy before any
  // staging. A private key alone is not publication authority.
  const host = { platform: descriptor.target.platform, arch: descriptor.target.arch, runtimeId: descriptor.runtime.id,
    nativeAbi: descriptor.runtime.nativeAbi, shellVersion: descriptor.runtime.minShellVersion, channel: descriptor.channel, minimumSequence: descriptor.sequence };
  verifyEnvelope(envelope, { trustedKeys, host });
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(path.join(output, '.prepare-'));
  try {
    await cp(source, path.join(staging, 'payload'), { recursive: true, dereference: false, errorOnExist: true });
    // This rejects mutations or link substitutions between inventory and copy.
    await verifyDirectory(path.join(staging, 'payload'), descriptor);
    await writeFile(path.join(staging, 'release.json'), canonical(envelope) + '\n', { mode: 0o444 });
    const assets = releaseAssetNames(envelope.releaseId);
    await writeFile(path.join(staging, assets.envelope), canonical(envelope) + '\n', { mode: 0o444 });
    const archive = await writeReleaseArchive(path.join(staging, 'payload'), descriptor, path.join(staging, assets.archive));
    const destination = path.join(output, releaseId(descriptor));
    try { await rename(staging, destination); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      const existing = JSON.parse(await readFile(path.join(destination, 'release.json'), 'utf8'));
      if (canonical(existing) !== canonical(envelope)) throw new Error('Conflicting immutable release');
      await verifyDirectory(path.join(destination, 'payload'), descriptor);
      if (await readFile(path.join(destination, assets.envelope), 'utf8') !== canonical(envelope) + '\n') throw new Error('Conflicting published envelope');
      const previousArchive = await fileDigest(path.join(destination, assets.archive));
      if (previousArchive.bytes !== archive.bytes || previousArchive.sha256 !== archive.sha256) throw new Error('Conflicting published archive');
    }
    return { releaseId: envelope.releaseId, directory: destination, files: files.length, assets, archive };
  } finally { await rm(staging, { force: true, recursive: true }); }
}
async function main() {
  const args = process.argv.slice(2);
  const permitted = ['--source', '--output', '--metadata', '--key-id', '--trusted-keys'];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--signing-key-stdin' && !flags.stdin) { flags.stdin = true; continue; }
    if (!permitted.includes(args[i]) || !args[i + 1] || flags[args[i]]) throw new Error('Invalid release packager arguments');
    flags[args[i]] = args[++i];
  }
  if (!flags.stdin || permitted.some(flag => !flags[flag]) || process.stdin.isTTY) throw new Error('Require source/output/metadata/key-id/trusted-keys and a protected signing-key stdin pipe');
  const chunks = [];
  let privateKey;
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
    privateKey = Buffer.concat(chunks);
    const result = await packageRelease({ source: flags['--source'], output: flags['--output'], metadata: JSON.parse(await readFile(flags['--metadata'], 'utf8')),
      keyId: flags['--key-id'], privateKey, trustedKeys: JSON.parse(await readFile(flags['--trusted-keys'], 'utf8')) });
    console.log(JSON.stringify(result));
  } finally { privateKey?.fill(0); for (const chunk of chunks) chunk.fill(0); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Native release packaging failed; check input integrity, compatibility and signing authorization.'); process.exitCode = 1; });
}
