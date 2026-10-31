import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  findRaycastManifest,
  prepareRaycastExtensionSource,
  type PreparedRaycastExtension,
  type PrepareRaycastExtensionOptions,
} from './manifest.js';

const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const DEFAULT_MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
const HARD_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_EXTRACTED_BYTES = 50 * 1024 * 1024;
const HARD_MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 1_000;
const HARD_MAX_ENTRIES = 5_000;

export interface RaycastArchiveLimits {
  maxArchiveBytes?: number;
  maxExtractedBytes?: number;
  maxEntries?: number;
}

export interface MaterializedRaycastExtensionArchive {
  path: string;
  files: number;
  bytes: number;
  archiveBytes: number;
  sha256: string;
}

export interface PrepareRaycastSideloadOptions extends PrepareRaycastExtensionOptions, RaycastArchiveLimits {
  /** Required for ZIP input. Commander should pass its managed extension cache directory. */
  destinationRoot?: string;
}

export interface PreparedRaycastSideload extends PreparedRaycastExtension {
  source: 'folder' | 'archive';
  materialized?: MaterializedRaycastExtensionArchive;
}

interface ZipEntry {
  name: string;
  relativePath: string;
  directory: boolean;
  compression: 0 | 8;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
}

/**
 * Materialize a ZIP into an immutable, hash-named cache folder. ZIP64, encryption,
 * links, unsupported compression, traversal, duplicate paths and zip bombs are rejected.
 */
export async function materializeRaycastExtensionArchive(
  archivePath: string,
  destinationRoot: string,
  limits: RaycastArchiveLimits = {},
): Promise<MaterializedRaycastExtensionArchive> {
  const archive = await realpath(archivePath);
  const details = await stat(archive);
  if (!details.isFile() || path.extname(archive).toLocaleLowerCase() !== '.zip')
    throw new Error('Raycast archive must be a .zip file');
  const maxArchiveBytes = boundedLimit(
    limits.maxArchiveBytes,
    DEFAULT_MAX_ARCHIVE_BYTES,
    HARD_MAX_ARCHIVE_BYTES,
    'archive',
  );
  const maxExtractedBytes = boundedLimit(
    limits.maxExtractedBytes,
    DEFAULT_MAX_EXTRACTED_BYTES,
    HARD_MAX_EXTRACTED_BYTES,
    'extracted',
  );
  const maxEntries = boundedLimit(limits.maxEntries, DEFAULT_MAX_ENTRIES, HARD_MAX_ENTRIES, 'entry');
  if (details.size > maxArchiveBytes)
    throw new Error(`Raycast ZIP exceeds the ${maxArchiveBytes} byte archive limit`);

  const bytes = await readFile(archive);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const entries = parseZip(bytes, maxEntries, maxExtractedBytes);
  const requestedRoot = path.resolve(destinationRoot);
  await mkdir(requestedRoot, { recursive: true });
  const root = await realpath(requestedRoot);
  const baseName = portableCacheName(path.basename(archive, path.extname(archive)));
  const destination = path.join(root, `${baseName}-${sha256.slice(0, 12)}`);
  try {
    await stat(destination);
    throw new Error(`Managed Raycast extension destination already exists: ${destination}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const temporary = await mkdtemp(path.join(root, `.${baseName}-unpack-`));
  let extractedBytes = 0;
  let files = 0;
  try {
    for (const entry of entries) {
      const target = path.resolve(temporary, ...entry.relativePath.split('/'));
      if (!target.startsWith(`${temporary}${path.sep}`))
        throw new Error(`Unsafe ZIP output path: ${entry.name}`);
      if (entry.directory) {
        await mkdir(target, { recursive: true });
        continue;
      }
      const payload = extractZipEntry(bytes, entry, maxExtractedBytes - extractedBytes);
      extractedBytes += payload.byteLength;
      files += 1;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, payload, { flag: 'wx' });
    }

    const extensionRoot = await locateExtractedExtensionRoot(temporary);
    if (extensionRoot === temporary) {
      await rename(temporary, destination);
    } else {
      await rename(extensionRoot, destination);
      await rm(temporary, { recursive: true, force: true });
    }
    return { path: destination, files, bytes: extractedBytes, archiveBytes: bytes.byteLength, sha256 };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

/** Inspect a folder sideload directly or atomically materialize a ZIP, then optionally build it. */
export async function prepareRaycastSideload(
  inputPath: string,
  options: PrepareRaycastSideloadOptions = {},
): Promise<PreparedRaycastSideload> {
  const input = await realpath(inputPath);
  const details = await stat(input);
  if (details.isDirectory()) {
    const prepared = await prepareRaycastExtensionSource(input, options);
    return { ...prepared, source: 'folder' };
  }
  if (!details.isFile() || path.extname(input).toLocaleLowerCase() !== '.zip')
    throw new Error('Raycast sideload must be an extension folder or .zip archive');
  if (!options.destinationRoot)
    throw new Error('destinationRoot is required to sideload a Raycast ZIP into managed storage');
  const materialized = await materializeRaycastExtensionArchive(input, options.destinationRoot, options);
  const prepared = await prepareRaycastExtensionSource(materialized.path, options);
  return { ...prepared, source: 'archive', materialized };
}

function parseZip(bytes: Buffer, maxEntries: number, maxExtractedBytes: number): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const disk = bytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
  const diskEntries = bytes.readUInt16LE(eocdOffset + 8);
  const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries)
    throw new Error('Multi-disk Raycast ZIP archives are not supported');
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff)
    throw new Error('ZIP64 Raycast archives are not supported');
  if (totalEntries > maxEntries) throw new Error(`Raycast ZIP contains more than ${maxEntries} entries`);
  if (centralOffset + centralSize !== eocdOffset || centralOffset + centralSize > bytes.byteLength)
    throw new Error('Raycast ZIP central directory is malformed');

  const entries: ZipEntry[] = [];
  const portablePaths = new Set<string>();
  let totalExtractedBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    ensureRange(bytes, cursor, 46, 'central directory entry');
    if (bytes.readUInt32LE(cursor) !== ZIP_CENTRAL_FILE)
      throw new Error('Raycast ZIP central directory entry is malformed');
    const versionMadeBy = bytes.readUInt16LE(cursor + 4);
    const flags = bytes.readUInt16LE(cursor + 8);
    const compression = bytes.readUInt16LE(cursor + 10);
    const crc32Value = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const diskStart = bytes.readUInt16LE(cursor + 34);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    ensureRange(bytes, cursor, entryLength, 'central directory entry');
    if (diskStart !== 0) throw new Error('Multi-disk Raycast ZIP archives are not supported');
    if ([compressedSize, uncompressedSize, localHeaderOffset].includes(0xffffffff))
      throw new Error('ZIP64 Raycast archive entries are not supported');
    if ((flags & 0x1) !== 0) throw new Error('Encrypted Raycast ZIP entries are not supported');
    if (compression !== 0 && compression !== 8)
      throw new Error(`Unsupported Raycast ZIP compression method: ${compression}`);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeZipName(nameBytes, flags);
    const relativePath = safeZipPath(name);
    const unixMode = versionMadeBy >>> 8 === 3 ? (externalAttributes >>> 16) & 0xffff : 0;
    if ((unixMode & 0xf000) === 0xa000)
      throw new Error(`Raycast ZIP symbolic links are not allowed: ${name}`);
    const directory = name.endsWith('/') || (unixMode & 0xf000) === 0x4000;
    const portableKey = relativePath.normalize('NFKC').toLocaleLowerCase('en-US');
    if (portablePaths.has(portableKey))
      throw new Error(`Raycast ZIP contains a duplicate portable path: ${name}`);
    portablePaths.add(portableKey);
    if (!directory) {
      totalExtractedBytes += uncompressedSize;
      if (!Number.isSafeInteger(totalExtractedBytes) || totalExtractedBytes > maxExtractedBytes)
        throw new Error(`Raycast ZIP exceeds the ${maxExtractedBytes} byte extracted limit`);
    }
    entries.push({
      name,
      relativePath,
      directory,
      compression: compression as 0 | 8,
      compressedSize,
      uncompressedSize,
      crc32: crc32Value,
      localHeaderOffset,
    });
    cursor += entryLength;
  }
  if (cursor !== eocdOffset) throw new Error('Raycast ZIP central directory size does not match its entries');
  return entries;
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const minimum = Math.max(0, bytes.byteLength - ZIP_EOCD_MIN_BYTES - ZIP_MAX_COMMENT_BYTES);
  for (let offset = bytes.byteLength - ZIP_EOCD_MIN_BYTES; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== ZIP_END) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength === bytes.byteLength) return offset;
  }
  throw new Error('Raycast ZIP end-of-central-directory record was not found');
}

function extractZipEntry(bytes: Buffer, entry: ZipEntry, remainingLimit: number): Buffer {
  ensureRange(bytes, entry.localHeaderOffset, 30, 'local file header');
  if (bytes.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE)
    throw new Error(`Raycast ZIP local header is malformed: ${entry.name}`);
  const localFlags = bytes.readUInt16LE(entry.localHeaderOffset + 6);
  const localCompression = bytes.readUInt16LE(entry.localHeaderOffset + 8);
  const nameLength = bytes.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = bytes.readUInt16LE(entry.localHeaderOffset + 28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  ensureRange(
    bytes,
    entry.localHeaderOffset,
    30 + nameLength + extraLength + entry.compressedSize,
    'local file data',
  );
  const localName = decodeZipName(
    bytes.subarray(entry.localHeaderOffset + 30, entry.localHeaderOffset + 30 + nameLength),
    localFlags,
  );
  if (localName !== entry.name || localCompression !== entry.compression || (localFlags & 0x1) !== 0)
    throw new Error(`Raycast ZIP local and central headers disagree: ${entry.name}`);
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  const output =
    entry.compression === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: Math.max(1, remainingLimit) });
  if (output.byteLength !== entry.uncompressedSize)
    throw new Error(`Raycast ZIP size check failed: ${entry.name}`);
  if (output.byteLength > remainingLimit)
    throw new Error(`Raycast ZIP exceeds the extracted byte limit at ${entry.name}`);
  if (crc32(output) !== entry.crc32) throw new Error(`Raycast ZIP checksum failed: ${entry.name}`);
  return output;
}

function decodeZipName(bytes: Buffer, flags: number): string {
  if ((flags & 0x800) === 0 && bytes.some((byte) => byte > 0x7f))
    throw new Error('Non-UTF-8 Raycast ZIP filenames are not supported');
  const value = bytes.toString('utf8');
  if (Buffer.from(value, 'utf8').compare(bytes) !== 0)
    throw new Error('Raycast ZIP contains an invalid UTF-8 filename');
  return value;
}

function safeZipPath(value: string): string {
  if (
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    /^[a-zA-Z]:/.test(value)
  )
    throw new Error(`Unsafe Raycast ZIP path: ${value || '(missing)'}`);
  const withoutTrailingSlash = value.endsWith('/') ? value.slice(0, -1) : value;
  const segments = withoutTrailingSlash.split('/');
  if (
    !segments.length ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        /[<>:"|?*\u0000-\u001f]/.test(segment) ||
        /[. ]$/.test(segment) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
    )
  ) {
    throw new Error(`Unsafe or non-portable Raycast ZIP path: ${value}`);
  }
  const normalized = path.posix.normalize(withoutTrailingSlash);
  if (normalized.startsWith('../') || path.posix.isAbsolute(normalized))
    throw new Error(`Unsafe Raycast ZIP path: ${value}`);
  return normalized;
}

async function locateExtractedExtensionRoot(temporary: string): Promise<string> {
  try {
    await findRaycastManifest(temporary);
    return temporary;
  } catch {
    const children = await readdir(temporary, { withFileTypes: true });
    const directoryCandidates = children.filter((entry) => entry.isDirectory() && entry.name !== '__MACOSX');
    const manifestCandidates: string[] = [];
    for (const child of directoryCandidates) {
      const candidate = path.join(temporary, child.name);
      try {
        await findRaycastManifest(candidate);
        manifestCandidates.push(candidate);
      } catch {
        /* Not an extension root. */
      }
    }
    if (manifestCandidates.length === 1) return manifestCandidates[0]!;
    throw new Error(
      'Raycast ZIP must contain one extension manifest at its root or inside one top-level folder',
    );
  }
}

function portableCacheName(value: string): string {
  const normalized = value
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'raycast-extension';
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  hardMaximum: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Raycast ZIP ${label} limit must be a positive safe integer`);
  return Math.min(value, hardMaximum);
}

function ensureRange(bytes: Buffer, offset: number, length: number, label: string): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.byteLength
  ) {
    throw new Error(`Raycast ZIP ${label} exceeds the archive bounds`);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
