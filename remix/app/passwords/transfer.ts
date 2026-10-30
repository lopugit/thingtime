import { importOnePasswordItem, exportOnePasswordItem } from './onePassword';
import { strToU8, zipSync } from 'fflate';
import { BlobReader, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { JSONParser } from '@streamparser/json';
import { emptyPasswordEntry, passwordFieldValue, validatePasswordEntry, type PasswordEntry, type FieldType, validPasswordId } from './model';
export type PasswordFormat = '1password' | 'chrome' | 'apple' | '1pux';
export type PasswordImport = { entries: PasswordEntry[]; warnings: string[] };
export type PasswordImportPreview = { fileCount: number; entries: Pick<PasswordEntry, 'title' | 'passwordType'>[]; count: number; warnings: string[] };
// Only explicitly safe diagnostics reach the UI. JSON/ZIP exceptions can contain secrets.
export class PasswordImportError extends Error {}
export const passwordImportErrorMessage = (error: unknown) => error instanceof PasswordImportError
  ? error.message : 'The file could not be read. Export it again and retry.';
const csvWarning = 'CSV files do not carry passkey private keys or attachments.';
const passkeyWarning = '1Password desktop exports do not include transferable passkey private keys.';
const textValue = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);

// Chunk boundaries may fall inside escaped quotes, CRLFs, BOMs and UTF-8 text.
export class PasswordCsvParser {
  private row: string[] = [];
  private field = '';
  private quoted = false;
  private closed = false;
  private skipLf = false;
  private started = false;
  constructor(private emit: (row: string[]) => void) {}
  write(text: string) {
    for (const char of text) {
      if (!this.started) { this.started = true; if (char === '\uFEFF') continue; }
      if (this.skipLf) { this.skipLf = false; if (char === '\n') continue; }
      if (this.quoted) {
        if (char === '"') { this.quoted = false; this.closed = true; }
        else this.field += char;
        continue;
      }
      if (char === '"' && this.closed) { this.field += '"'; this.quoted = true; this.closed = false; continue; }
      if (char === '"' && !this.field) { this.quoted = true; continue; }
      if (char === ',' || char === '\r' || char === '\n') {
        this.row.push(this.field); this.field = ''; this.closed = false;
        if (char !== ',') { this.finishRow(); this.skipLf = char === '\r'; }
      } else {
        if (this.closed || char === '"') throw new PasswordImportError('Malformed CSV quoting.');
        this.field += char;
      }
    }
  }
  private finishRow() { if (this.row.some(value => value !== '')) this.emit(this.row); this.row = []; }
  end() {
    if (this.quoted) throw new PasswordImportError('An imported CSV field has an unclosed quote.');
    this.row.push(this.field); this.field = ''; this.finishRow();
  }
}
export function parsePasswordCsv(text: string): string[][] {
  const rows: string[][] = [], parser = new PasswordCsvParser(row => rows.push(row));
  parser.write(text); parser.end(); return rows;
}
function csvMapper(header: string[]) {
  const keys = header.map(value => value.trim().toLowerCase());
  if (new Set(keys).size !== keys.length || !keys.includes('password')) throw new PasswordImportError('Choose a Chrome, Apple Passwords, or 1Password CSV export with a Password column.');
  const known = new Set(['name', 'title', 'url', 'website', 'username', 'password', 'note', 'notes', 'otpauth', 'one-time password']);
  return (row: string[], index: number): PasswordEntry => {
    if (row.length !== header.length) throw new PasswordImportError(`CSV row ${index + 2} has the wrong number of columns.`);
    const read = (...names: string[]) => { const i = keys.findIndex(key => names.includes(key)); return i < 0 ? '' : row[i]; };
    const entry = emptyPasswordEntry(); entry.title = read('name', 'title') || read('url', 'website') || `Imported login ${index + 1}`;
    entry.fields[0].value = read('username'); entry.fields[1].value = read('password'); entry.fields[2].value = read('url', 'website');
    const notes = read('notes', 'note'), otp = read('otpauth', 'one-time password');
    if (notes) entry.fields.push({ id: 'notes', label: 'Notes', type: 'notes', value: notes });
    if (otp) entry.fields.push({ id: 'totp', label: 'Verification code', type: 'totp', value: otp });
    keys.forEach((key, i) => { if (!known.has(key) && row[i]) entry.fields.push({ id: `import-${i}`, label: header[i] || `Field ${i + 1}`, type: 'text', value: row[i] }); });
    try { return validatePasswordEntry(entry); } catch { throw new PasswordImportError(`CSV row ${index + 2} contains an invalid entry.`); }

  };
}
export function importPasswordCsv(text: string): PasswordImport {
  const [header, ...rows] = parsePasswordCsv(text);
  if (!header) throw new PasswordImportError('The CSV file is empty.');
  return { entries: rows.map(csvMapper(header)), warnings: [csvWarning] };
}
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
// Work chunks regulate memory/backpressure; they do not limit file or entry size.
const CHUNK_BYTES = 64 * 1024;
export type ImportedPasswordFile = { name: string; path: string; size: number; entryIndex?: number; original?: { id?: string; name: string; archivePath?: string; role?: 'attachment' | 'source' | 'icon' | 'document' }; open: () => ReadableStream<Uint8Array> };
type VisitOptions = { onFile?: (file: ImportedPasswordFile, index: number) => void | Promise<void>; signal?: AbortSignal; onEntry: (entry: PasswordEntry, index: number, sourceId?: string) => void | Promise<void>; onProgress?: (count: number) => void };
export async function visitPasswordFile(file: Blob & { name: string }, options: VisitOptions) {
  const { signal } = options, warnings = new Set<string>();
  let count = 0, fileCount = 0, callbackFailure: unknown;
  const consume = async (entry: PasswordEntry, sourceId?: string) => {
    cancelled(signal);
    try { await options.onEntry(entry, count, sourceId); } catch (error) { callbackFailure = error; throw error; }
    count++; options.onProgress?.(count);
  };
  try {
    if (file.name.toLowerCase().endsWith('.1pux')) {
      const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false, checkSignature: true });
      try {
        // Retain descriptors, never expanded file contents.
        let attributes: FileEntry | undefined, data: FileEntry | undefined;
        const files: FileEntry[] = [], names = new Set<string>();
        for await (const member of reader.getEntriesGenerator()) {
          cancelled(signal);
          if (member.directory || !("getData" in member)) continue;
          if (member.encrypted) throw new PasswordImportError('Choose the 1Password Unencrypted Export (.1pux) format.');
          if (names.has(member.filename)) throw new PasswordImportError('The archive contains duplicate file paths. Export it again.');
          names.add(member.filename); files.push(member); fileCount++;
          if (member.filename === 'export.data') {
            if (data) throw new PasswordImportError('The archive contains duplicate export.data files. Export it again.');
            data = member;
          } else if (member.filename === 'export.attributes') {
            if (attributes) throw new PasswordImportError('The archive contains duplicate export.attributes files. Export it again.');
            attributes = member;
          }
        }
        if (!data || !attributes) throw new PasswordImportError('Choose a 1Password .1pux export containing export.data and export.attributes.');
        if (data.encrypted || attributes.encrypted) throw new PasswordImportError('Choose the 1Password Unencrypted Export (.1pux) format.');
        let version: unknown;
        const attrsParser = new JSONParser({ paths: ['$.version'], keepStack: false });
        attrsParser.onValue = ({ value }) => { version = value; };
        await attributes.getData(new WritableStream({ write(bytes) { cancelled(signal); attrsParser.write(bytes); } }), { signal });
        if (!attrsParser.isEnded) attrsParser.end();
        if (version !== 3) throw new PasswordImportError('Only 1PUX version 3 is supported. Export it again using 1Password.');
        // Attribute order is not significant in JSON. Read only account/vault
        // metadata first, so attributes after the items are preserved as well.
        const contexts = new Map<string, unknown>();
        const contextParser = new JSONParser({ paths: ['$.accounts.*.attrs', '$.accounts.*.vaults.*.attrs'], keepStack: false, stringBufferSize: CHUNK_BYTES });
        contextParser.onValue = ({ value, stack }) => { contexts.set(JSON.stringify(stack.map(frame => frame.key).slice(1)), value); };
        await data.getData(new WritableStream({ write(bytes) { cancelled(signal); contextParser.write(bytes); } }), { signal });
        if (!contextParser.isEnded) contextParser.end();
        const restoredIds = new Set<string>();
        const pending: any[] = [], fileOwners = new Map<string, { index: number; original: ImportedPasswordFile['original'] }>();
        // keepStack:false releases completed items; the vault is never accumulated in memory.
        const parser = new JSONParser({ paths: ['$.accounts.*.vaults.*.items.*'], keepStack: false, stringBufferSize: CHUNK_BYTES });
        parser.onValue = ({ value, stack }) => { pending.push({ item: value, accountIndex: stack[2]?.key, vaultIndex: stack[4]?.key }); };
        const flush = async () => {
          for (const { item, accountIndex, vaultIndex } of pending) {
            let entry: PasswordEntry;
            try { entry = importOnePasswordItem(item); if (!item?.details?.thingtime) entry.onePasswordContext = JSON.stringify({ account: contexts.get(JSON.stringify(['accounts', accountIndex])), vault: contexts.get(JSON.stringify(['accounts', accountIndex, 'vaults', vaultIndex])) }); }
            catch { throw new PasswordImportError(`1PUX item ${count + 1} contains invalid fields. Nothing is truncated; check that item in the source vault.`); }
            const vendor = item?.details?.thingtime;
            if (vendor?.version === 1 && vendor.id !== undefined) {
              if (!validPasswordId(vendor.id) || restoredIds.has(vendor.id)) throw new PasswordImportError('Invalid or repeated backup entry ids.');
              restoredIds.add(vendor.id);
            }
            if (vendor?.version === 1 && Array.isArray(vendor.files)) for (const file of vendor.files) {
              if (typeof file.path !== 'string' || typeof file.name !== 'string' || fileOwners.has(file.path)) throw new PasswordImportError('Invalid backup file references.');
              fileOwners.set(file.path, { index: count, original: { ...(typeof file.id === 'string' && /^att_[a-f0-9]{64}$/.test(file.id) ? { id: file.id } : {}), name: file.name, ...(typeof file.archivePath === 'string' ? { archivePath: file.archivePath } : {}), ...(['attachment', 'source', 'icon', 'document'].includes(file.role) ? { role: file.role } : {}) } });
            }
            await consume(entry, vendor?.version === 1 && typeof vendor.id === 'string' ? vendor.id : undefined);
          }
          pending.length = 0;
        };
        await data.getData(new WritableStream({ async write(bytes) { cancelled(signal); parser.write(bytes); await flush(); } }), { signal });
        if (!parser.isEnded) parser.end();
        await flush();
        for (const path of fileOwners.keys()) if (!names.has(path)) throw new PasswordImportError('A referenced backup file is missing. Export it again.');
        // Preserve every member, including both original JSON documents and unknown files.
        // Bytes never pass through a text conversion or filesystem path.
        if (options.onFile) for (const [index, member] of files.entries()) {
          cancelled(signal);
          if (member.encrypted) throw new PasswordImportError('An archive file is encrypted. Choose a 1PUX export.');
          try { await options.onFile({ name: member.filename.split('/').at(-1) || member.filename, path: member.filename, size: member.uncompressedSize, ...(fileOwners.has(member.filename) ? { entryIndex: fileOwners.get(member.filename)!.index, original: fileOwners.get(member.filename)!.original } : {}), open: () => {
            let output: TransformStreamDefaultController<Uint8Array>;
            const pipe = new TransformStream<Uint8Array, Uint8Array>({ start(controller) { output = controller; } });
            member.getData(pipe.writable, { signal }).catch(() => { try { output.error(new PasswordImportError('An archive file failed its integrity check. Export it again.')); } catch { /* Reader already cancelled. */ } });
            return pipe.readable;
          } }, index); } catch (error) { callbackFailure = error; throw error; }
        }
        warnings.add(passkeyWarning);
      } finally { await reader.close(); }
    } else {
      let mapper: ReturnType<typeof csvMapper> | undefined;
      const pending: PasswordEntry[] = [], decoder = new TextDecoder();
      const parser = new PasswordCsvParser(row => { if (!mapper) mapper = csvMapper(row); else pending.push(mapper(row, count + pending.length)); });
      const flush = async () => { for (const entry of pending) await consume(entry); pending.length = 0; };
      for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
        cancelled(signal);
        parser.write(decoder.decode(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer(), { stream: true }));
        await flush();
      }
      parser.write(decoder.decode()); parser.end(); await flush();
      if (!mapper) throw new PasswordImportError('The CSV file is empty.');
      warnings.add(csvWarning);
    }
    cancelled(signal);
    return { count, fileCount, warnings: [...warnings] };
  } catch (error) {
    if (callbackFailure === error || error instanceof PasswordImportError || (error as Error)?.name === 'AbortError') throw error;
    throw new PasswordImportError('The export is incomplete or malformed. Export it again and retry.');
  }
}
export async function previewPasswordFile(file: Blob & { name: string }, signal?: AbortSignal, onProgress?: (count: number) => void): Promise<PasswordImportPreview> {
  const entries: PasswordImportPreview['entries'] = [];
  const result = await visitPasswordFile(file, { signal, onProgress, onEntry: ({ title, passwordType }) => {
    // A display window, never a limit on the entries that will be saved.
    if (entries.length < 50) entries.push({ title, passwordType });
  } });
  return { ...result, entries };
}
export async function import1Pux(bytes: Uint8Array): Promise<PasswordImport> {
  const entries: PasswordEntry[] = [];
  const result = await visitPasswordFile(new File([bytes as BlobPart], 'export.1pux'), { onEntry: entry => { entries.push(entry); } });
  return { entries, warnings: result.warnings };
}
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
export function exportPasswords(entries: PasswordEntry[], format: PasswordFormat): { bytes: Uint8Array; extension: string; mime: string } {
  entries.forEach(validatePasswordEntry);
  if (format === '1pux') {
    const now = Math.floor(Date.now() / 1000);
    const data = { accounts: [{ attrs: { accountName: 'Thingtime', name: 'Thingtime', uuid: crypto.randomUUID(), domain: 'https://thingtime.com' }, vaults: [{ attrs: { uuid: crypto.randomUUID(), name: 'Passwords', desc: '', type: 'P' }, items: entries.map(exportOnePasswordItem) }] }] };
    return { bytes: zipSync({ 'export.attributes': strToU8(JSON.stringify({ version: 3, description: '1Password Unencrypted Export', createdAt: now })), 'export.data': strToU8(JSON.stringify(data)) }), extension: '1pux', mime: 'application/zip' };
  }
  const header = format === 'chrome' ? ['name', 'url', 'username', 'password', 'note'] : format === 'apple' ? ['Title', 'URL', 'Username', 'Password', 'Notes', 'OTPAuth'] : ['Title', 'Website', 'Username', 'Password', 'One-time password', 'Favorite', 'Archived', 'Tags', 'Notes'];
  const rows = entries.map(entry => {
    const common = [entry.title, passwordFieldValue(entry, 'website'), passwordFieldValue(entry, 'username'), passwordFieldValue(entry, 'password')], notes = passwordFieldValue(entry, 'notes'), otp = entry.fields.find(field => field.type === 'totp')?.value || '';
    return format === 'chrome' ? [...common, notes] : format === 'apple' ? [...common, notes, otp] : [...common, otp, 'false', 'false', '', notes];
  });
  return { bytes: strToU8([header, ...rows].map(row => row.map(quote).join(',')).join('\r\n')), extension: 'csv', mime: 'text/csv;charset=utf-8' };
}

// Legacy synchronous export batching. Browser exports use the streaming ZIP writer.
export function exportPasswordBackup(entries: PasswordEntry[], format: PasswordFormat) {
  const parts: PasswordEntry[][] = []; let part: PasswordEntry[] = [], bytes = 0;
  for (const entry of entries) {
    const size = strToU8(JSON.stringify(entry)).length;
    if (part.length && (part.length >= 1000 || bytes + size > 4 * 1024 * 1024)) { parts.push(part); part = []; bytes = 0; }
    part.push(entry); bytes += size;
  }
  if (part.length || !parts.length) parts.push(part);
  if (parts.length === 1) return exportPasswords(parts[0], format);
  const files: Record<string, Uint8Array> = {};
  parts.forEach((items, index) => {
    const output = exportPasswords(items, format);
    files[`thingtime-passwords-${String(index + 1).padStart(3, '0')}.${output.extension}`] = output.bytes;
  });
  files['README.txt'] = strToU8('This ZIP contains unencrypted secrets. Extract it, then import each numbered file once. Keep every part until you have verified the restored entries.');
  return { bytes: zipSync(files, { level: 0 }), extension: 'zip', mime: 'application/zip' };
}
