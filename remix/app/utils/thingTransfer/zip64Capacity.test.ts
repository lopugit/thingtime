import test from 'node:test';
import assert from 'node:assert/strict';
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { encodeTransferArchiveBlob } from './archive';
import { TRANSFER_FORMAT } from './format';
import { usesNodeBlobBackend } from './binary';

/** Real file-backed >4GiB encoding requires Python3 and temporary archive disk
 * capacity. This does not claim bounded Node Blob decoder backing memory. */
test('real 4GiB+1 sparse file exports ZIP64 and Python independently checks every byte', {
  skip: process.env.TT_TRANSFER_ZIP64_TEST !== '1', timeout: 1800000,
}, async context => {
  if (usesNodeBlobBackend()) {
    context.skip('No 4GiB acceptance: Node 24.18.0 openAsBlob truncated 4GiB+1 to 1 byte; composite slicing fatally asserted at node_blob.cc:277. Native Chromium proof is required. Conservative Node backend guard remains active until safely verified otherwise.');
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'thingtime-zip64-'));
  const bytes = 0x100000001;
  let result: Record<string, unknown> | undefined;
  try {
    // Node 24 openAsBlob truncates a single >4GiB file length to uint32.
    // Compose real, independently checked file-backed parts below that boundary.
    // Every payload byte is still hashed/exported/read by Python; no size spoof.
    const parts: Blob[] = [];
    for (let left = bytes, index = 0; left > 0; index++) {
      const length = Math.min(left, 1024 * 1024 * 1024);
      const path = join(directory, `source-${index}.bin`);
      const source = await open(path, 'w');
      try { await source.truncate(length); } finally { await source.close(); }
      assert.equal((await stat(path)).size, length);
      const blob = await openAsBlob(path);
      assert.equal(blob.size, length, 'Node must expose every byte of each file-backed source part');
      parts.push(blob);
      left -= length;
    }
    const sourceBlob = new Blob(parts);
    assert.equal(sourceBlob.size, bytes, 'The genuine file-backed input must be 4GiB+1');
    const hash = createHash('sha256');
    const block = new Uint8Array(1024 * 1024);
    for (let left = bytes; left > 0; left -= Math.min(left, block.length)) hash.update(block.subarray(0, Math.min(left, block.length)));
    const digest = hash.digest('hex');
    const trailing = new TextEncoder().encode('actual trailing ZIP64 offset fixture\n');
    const trailingDigest = createHash('sha256').update(trailing).digest('hex');
    const archive = await encodeTransferArchiveBlob({
      manifest: { format: TRANSFER_FORMAT, version: 1, roots: ['root'], things: [{ id: 'root', thingtime: ['data'], crystal: {} }],
        files: [{ id: 'large', targetId: 'root', path: 'files/000000', name: 'source.bin', mime: 'application/octet-stream', bytes, sha256: digest },
          { id: 'trailing', targetId: 'root', path: 'files/000001', name: 'trailing.txt', mime: 'text/plain', bytes: trailing.length, sha256: trailingDigest }] },
      files: new Map([['large', sourceBlob], ['trailing', new Blob([trailing])]]),
    }, context.signal);
    assert.ok(archive.size > bytes + trailing.length);
    const outputPath = join(directory, 'archive.zip');
    await pipeline(Readable.fromWeb(archive.stream() as never), createWriteStream(outputPath), { signal: context.signal });
    const script = `import hashlib, json, os, struct, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    info = archive.getinfo('files/000000')
    assert info.file_size == 0x100000001
    assert info.extract_version >= 45
    digest = hashlib.sha256()
    with archive.open(info) as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk: break
            digest.update(chunk)
    assert digest.hexdigest() == sys.argv[2]
    trailing = archive.getinfo('files/000001')
    assert trailing.header_offset > 0xffffffff
    assert trailing.extract_version >= 45
    assert hashlib.sha256(archive.read(trailing)).hexdigest() == sys.argv[3]
    manifest = json.loads(archive.read('thingtime.json'))
    assert manifest['files'][0]['bytes'] == info.file_size
    assert manifest['files'][0]['sha256'] == sys.argv[2]
    assert manifest['files'][1]['sha256'] == sys.argv[3]
    with open(sys.argv[1], 'rb') as raw:
        raw.seek(-98, 2)
        footer = raw.read(98)
        assert footer[:4] == b'PK\\x06\\x06'
        assert footer[56:60] == b'PK\\x06\\x07'
        assert footer[76:80] == b'PK\\x05\\x06'
        assert struct.unpack_from('<Q', footer, 32)[0] == 3
        assert struct.unpack_from('<Q', footer, 48)[0] > 0xffffffff
    print(json.dumps({'payloadBytes': info.file_size, 'archiveBytes': os.path.getsize(sys.argv[1]), 'sha256': sys.argv[2], 'trailingBytes': trailing.file_size, 'trailingOffset': trailing.header_offset, 'independentVerification': 'Python zipfile CRC32 and streamed SHA256; ZIP64 directory, locator, footer and manifest checked'}))
`;
    const pythonResult = await new Promise<string>((resolve, reject) => {
      const child = spawn('python3', ['-c', script, outputPath, digest, trailingDigest], { stdio: ['ignore', 'pipe', 'pipe'], signal: context.signal });
      let diagnostic = '', output = '';
      child.stdout.on('data', chunk => { output = (output + String(chunk)).slice(-4096); });
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-4096); });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`Python ZIP verification failed (${code}): ${diagnostic}`)));
    });
    result = JSON.parse(pythonResult) as Record<string, unknown>;
    assert.equal(result.payloadBytes, bytes);
    assert.equal(result.archiveBytes, archive.size);
  } finally { await rm(directory, { recursive: true, force: true }); }
  context.diagnostic(JSON.stringify({ ...result, cleanup: 'temporary source parts and archive removed' }));
});
