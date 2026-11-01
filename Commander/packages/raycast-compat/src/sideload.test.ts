import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectRaycastExtensionSource } from './manifest.js';
import { materializeRaycastExtensionArchive, prepareRaycastSideload } from './sideload.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'commander-raycast-zip-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

interface TestZipEntry {
  name: string;
  content: string;
  mode?: number;
}

function testZip(entries: TestZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.from(entry.content, 'utf8');
    const checksum = testCrc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.byteLength, 18);
    local.writeUInt32LE(content.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.byteLength, 20);
    central.writeUInt32LE(content.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.byteLength + name.byteLength + content.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

describe('Raycast ZIP sideload', () => {
  it('atomically materializes a wrapped extension and finds its build entry', async () => {
    const directory = await temporaryDirectory();
    const archive = path.join(directory, 'hello.zip');
    const manifest = JSON.stringify({
      name: 'hello',
      type: 'module',
      commands: [{ name: 'wave', title: 'Wave', mode: 'no-view' }],
    });
    await writeFile(
      archive,
      testZip([
        { name: 'hello/package.json', content: manifest },
        { name: 'hello/dist/wave.js', content: 'export default async function wave() {}' },
      ]),
    );
    const result = await materializeRaycastExtensionArchive(archive, path.join(directory, 'cache'));
    const report = await inspectRaycastExtensionSource(result.path);
    expect(result).toMatchObject({
      files: 2,
      archiveBytes: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(report.readyNoViewCommands).toBe(1);
    expect(report.commands[0]?.buildEntry).toBe(path.join(report.extensionPath, 'dist', 'wave.js'));
  });

  it('rejects traversal and removes the partial extraction folder', async () => {
    const directory = await temporaryDirectory();
    const archive = path.join(directory, 'escape.zip');
    const cache = path.join(directory, 'cache');
    await mkdir(cache);
    await writeFile(archive, testZip([{ name: '../escape.txt', content: 'nope' }]));
    await expect(materializeRaycastExtensionArchive(archive, cache)).rejects.toThrow(
      'Unsafe or non-portable Raycast ZIP path',
    );
    expect(await readdir(cache)).toEqual([]);
  });

  it('rejects symbolic links before writing archive content', async () => {
    const directory = await temporaryDirectory();
    const archive = path.join(directory, 'link.zip');
    await writeFile(archive, testZip([{ name: 'package.json', content: '../outside', mode: 0o120777 }]));
    await expect(materializeRaycastExtensionArchive(archive, path.join(directory, 'cache'))).rejects.toThrow(
      'symbolic links are not allowed',
    );
  });

  it('enforces the declared extracted byte budget', async () => {
    const directory = await temporaryDirectory();
    const archive = path.join(directory, 'large.zip');
    await writeFile(archive, testZip([{ name: 'package.json', content: '12345678901' }]));
    await expect(
      materializeRaycastExtensionArchive(archive, path.join(directory, 'cache'), { maxExtractedBytes: 10 }),
    ).rejects.toThrow('extracted limit');
  });

  it('prepares and explicitly builds an archive sideload in managed storage', async () => {
    const directory = await temporaryDirectory();
    const archive = path.join(directory, 'source.zip');
    const manifest = JSON.stringify({
      name: 'source',
      type: 'module',
      scripts: { build: 'node build.mjs' },
      commands: [{ name: 'wave', title: 'Wave', mode: 'no-view' }],
    });
    const build =
      "import { mkdir, writeFile } from 'node:fs/promises'; await mkdir('dist'); await writeFile('dist/wave.js', 'export default async function wave() {}');";
    await writeFile(
      archive,
      testZip([
        { name: 'package.json', content: manifest },
        { name: 'src/wave.ts', content: 'export default async function wave() {}' },
        { name: 'build.mjs', content: build },
      ]),
    );
    const result = await prepareRaycastSideload(archive, {
      destinationRoot: path.join(directory, 'cache'),
      build: true,
      allowUntrustedBuildScripts: true,
    });
    expect(result.source).toBe('archive');
    expect(result.build).toMatchObject({ attempted: true, exitCode: 0 });
    expect(result.report.readyNoViewCommands).toBe(1);
    expect(result.materialized?.path).toBe(result.report.extensionPath);
  });
});

const TEST_CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function testCrc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = TEST_CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
