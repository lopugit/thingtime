import test from 'node:test';
import assert from 'node:assert/strict';
import { Unzip, unzipSync } from 'fflate';
import { planStoredZip, storedZipBlob } from './storedZip';

const MAX = 0xffffffff;
test('ZIP64 planning reserves exact size and offset sentinels and checks overhead', () => {
  for (const bytes of [MAX - 1, MAX, MAX + 1]) {
    const plan = planStoredZip([{ path: 'a', bytes }]);
    assert.equal(plan.files[0].large, bytes >= MAX);
    assert.equal(plan.files[0].localSize, bytes >= MAX ? 51 : 31);
    assert.equal(plan.zip64, true);
    assert.equal(plan.size, plan.directoryOffset + plan.directorySize + 98);
  }
  for (const offset of [MAX - 1, MAX, MAX + 1]) {
    const plan = planStoredZip([{ path: 'a', bytes: offset - 31 }, { path: 'b', bytes: 1 }]);
    assert.equal(plan.files[0].large, false);
    assert.equal(plan.files[1].offset, offset);
    assert.equal(plan.files[1].largeOffset, offset >= MAX);
    assert.equal(plan.files[1].centralSize, offset >= MAX ? 59 : 47);
  }
  const aggregate = planStoredZip([{ path: 'a', bytes: 0x80000000 }, { path: 'b', bytes: 0x80000000 }]);
  assert.ok(aggregate.files.every(file => !file.large));
  assert.equal(aggregate.zip64, true);
  assert.equal(planStoredZip(Array.from({ length: 0xffff }, () => ({ path: 'a', bytes: 0 }))).zip64, true);
});

test('archive arithmetic refuses invalid or imprecise sizes including accumulated overflow', () => {
  for (const bytes of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => planStoredZip([{ path: 'a', bytes }]), /safe integer/);
  }
  assert.throws(() => planStoredZip([{ path: 'a', bytes: Number.MAX_SAFE_INTEGER - 100 }, { path: 'b', bytes: 100 }]), /safe integer/);
});

test('small stored archives remain standard ZIP32 and carry CRC32', async () => {
  const data = new TextEncoder().encode('hello');
  const plan = planStoredZip([{ path: 'hello.txt', bytes: data.length }]);
  const archive = storedZipBlob(plan, [{ blob: new Blob([data]), crc: 0x3610a686 }]);
  assert.equal(archive.size, plan.size);
  const bytes = new Uint8Array(await archive.arrayBuffer());
  assert.deepEqual(unzipSync(bytes)['hello.txt'], data);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(14, true), 0x3610a686);
  assert.equal(view.getUint32(plan.directoryOffset + 16, true), 0x3610a686);
  assert.equal(view.getUint32(plan.size - 22, true), 0x06054b50);
});

test('ZIP64 end records are compatible for a small archive', async () => {
  const base = planStoredZip([{ path: 'empty', bytes: 0 }]);
  const plan = { ...base, zip64: true, size: base.size + 76 };
  const bytes = new Uint8Array(await storedZipBlob(plan, [{ blob: new Blob(), crc: 0 }]).arrayBuffer());
  assert.equal(unzipSync(bytes).empty.length, 0);
  const view = new DataView(bytes.buffer);
  const start = plan.directoryOffset + plan.directorySize;
  assert.equal(view.getUint32(start, true), 0x06064b50);
  assert.equal(view.getBigUint64(start + 4, true), BigInt(44));
  assert.equal(view.getBigUint64(start + 48, true), BigInt(plan.directoryOffset));
  assert.equal(view.getUint32(start + 56, true), 0x07064b50);
  assert.equal(view.getBigUint64(start + 64, true), BigInt(start));
});


test('streaming decoder reads ZIP64 local extras split across input chunks', async () => {
  const base = planStoredZip([{ path: 'hello.txt', bytes: 5 }]);
  // ZIP64 is legal for small files too. Force the actual framing, rather than
  // pretending this five-byte payload proves multi-gigabyte acceptance.
  const plan = { ...base, files: base.files.map(file => ({ ...file, large: true, localSize: file.localSize + 20, centralSize: file.centralSize + 20 })),
    directoryOffset: base.directoryOffset + 20, directorySize: base.directorySize + 20, zip64: true, size: base.size + 116 };
  const archive = storedZipBlob(plan, [{ blob: new Blob(['hello']), crc: 0x3610a686 }]);
  const bytes = new Uint8Array(await archive.arrayBuffer());
  assert.deepEqual(unzipSync(bytes)['hello.txt'], new TextEncoder().encode('hello'));
  const chunks: Uint8Array[] = [];
  let complete = false;
  const unzip = new Unzip(file => {
    assert.equal(file.size, 5); assert.equal(file.originalSize, 5);
    file.ondata = (error, data, final) => { if (error) throw error; chunks.push(data); complete = final; };
    file.start();
  });
  for (let offset = 0; offset < bytes.length; offset += 7) unzip.push(bytes.subarray(offset, offset + 7), offset + 7 >= bytes.length);
  assert.equal(complete, true);
  assert.equal(await new Blob(chunks.map(chunk => Uint8Array.from(chunk))).text(), 'hello');
});
