import { openAsBlob, createWriteStream, constants } from 'node:fs';
import { open, chmod } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import path from 'node:path';
import { planStoredZip, storedZipBlob } from '../remix/app/utils/thingTransfer/storedZipCore.mjs';
import inventory from './inventory.cjs';

export const releaseAssetNames = releaseId => {
  if (!/^[a-f0-9]{64}$/.test(releaseId)) throw new Error('Invalid release asset identity');
  return { envelope: `native-web-${releaseId}.json`, archive: `native-web-${releaseId}.zip` };
};

export async function fileDigest(location) {
  const handle = await open(location, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error('Release archive is not a regular file');
    const hash = createHash('sha256');
    let bytes = 0, crc = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length; hash.update(chunk); crc = crc32(chunk, crc);
    }
    const after = await handle.stat();
    if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Release bytes changed during packaging');
    return { bytes, sha256: hash.digest('hex'), crc };
  } finally { await handle.close(); }
}

/** Same stored ZIP/ZIP64 layout as portable Thing archives. File-backed Blobs
 * stream payloads without buffering the complete bundle or extracting paths. */
export async function writeReleaseArchive(payload, descriptor, destination) {
  await inventory.verifyDirectory(payload, descriptor);
  const plan = planStoredZip(descriptor.files), blobs = [];
  for (const file of descriptor.files) {
    const location = path.join(payload, ...file.path.split('/'));
    const actual = await fileDigest(location);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new Error('Release payload changed during packaging');
    const blob = await openAsBlob(location);
    if (blob.size !== file.bytes) throw new Error('Release payload changed before archive');
    blobs.push({ blob, crc: actual.crc });
  }
  const archive = storedZipBlob(plan, blobs);
  await pipeline(Readable.fromWeb(archive.stream()), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  await inventory.verifyDirectory(payload, descriptor);
  const digest = await fileDigest(destination);
  if (digest.bytes !== plan.size) throw new Error('Incomplete native release archive');
  await chmod(destination, 0o444);
  return { bytes: digest.bytes, sha256: digest.sha256 };
}
