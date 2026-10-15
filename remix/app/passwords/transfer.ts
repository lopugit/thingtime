import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { emptyPasswordEntry, passwordFieldValue, validatePasswordEntry, type PasswordEntry, type FieldType } from './model';
export type PasswordFormat = '1password' | 'chrome' | 'apple' | '1pux';
export type PasswordImport = { entries: PasswordEntry[]; warnings: string[] };
const MAX_BYTES = 20 * 1024 * 1024, MAX_ROWS = 2000;
export function parsePasswordCsv(text: string): string[][] {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Import at most 20 MiB at a time.');
  text = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [], row: string[] = []; let field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += char;
      continue;
    }
    if (char === '"' && !field && !closed) { quoted = true; continue; }
    if (char === ',' || char === '\r' || char === '\n') {
      row.push(field); field = ''; closed = false;
      if (char !== ',') { if (row.some(value => value !== '')) rows.push([...row]); row.length = 0; if (char === '\r' && text[i + 1] === '\n') i++; }
      if (rows.length > MAX_ROWS + 1) throw new Error('Import at most 2,000 entries at a time.');
    } else { if (closed || char === '"') throw new Error('Malformed CSV quoting.'); field += char; }
  }
  if (quoted) throw new Error('An imported CSV field has an unclosed quote.');
  row.push(field); if (row.some(value => value !== '')) rows.push([...row]);
  return rows;
}
const textValue = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
export function importPasswordCsv(text: string): PasswordImport {
  const [header, ...rows] = parsePasswordCsv(text);
  if (!header) throw new Error('The CSV file is empty.');
  const keys = header.map(value => value.trim().toLowerCase());
  if (new Set(keys).size !== keys.length || !keys.includes('password')) throw new Error('Choose a Chrome, Apple Passwords, or 1Password CSV export with a Password column.');
  const known = new Set(['name', 'title', 'url', 'website', 'username', 'password', 'note', 'notes', 'otpauth', 'one-time password']);
  const entries = rows.map((row, index) => {
    if (row.length !== header.length) throw new Error(`CSV row ${index + 2} has the wrong number of columns.`);
    const read = (...names: string[]) => { const i = keys.findIndex(key => names.includes(key)); return i < 0 ? '' : row[i]; };
    const entry = emptyPasswordEntry(); entry.title = read('name', 'title') || read('url', 'website') || `Imported login ${index + 1}`;
    entry.fields[0].value = read('username'); entry.fields[1].value = read('password'); entry.fields[2].value = read('url', 'website');
    const notes = read('notes', 'note'), otp = read('otpauth', 'one-time password');
    if (notes) entry.fields.push({ id: 'notes', label: 'Notes', type: 'notes', value: notes });
    if (otp) entry.fields.push({ id: 'totp', label: 'Verification code', type: 'totp', value: otp });
    keys.forEach((key, i) => { if (!known.has(key) && row[i]) entry.fields.push({ id: `import-${i}`, label: header[i] || `Field ${i + 1}`, type: 'text', value: row[i] }); });
    try { return validatePasswordEntry(entry); } catch { throw new Error(`CSV row ${index + 2} exceeds the entry limits.`); }
  });
  if (entries.length > MAX_ROWS) throw new Error('Import at most 2,000 entries at a time.');
  return { entries, warnings: ['CSV files do not carry passkey private keys or attachments.'] };
}
export function import1Pux(bytes: Uint8Array): PasswordImport {
  if (bytes.length > MAX_BYTES) throw new Error('Import at most 20 MiB at a time.');
  let total = 0, count = 0, omittedFiles = 0;
  const files = unzipSync(bytes, { filter: file => {
    if (++count > 10000 || (total += file.originalSize) > 50 * 1024 * 1024) throw new Error('The archive expands beyond the import limit.');
    if (file.name !== 'export.data' && file.name !== 'export.attributes') { if (!file.name.endsWith('/')) omittedFiles++; return false; }
    if (file.originalSize > MAX_BYTES) throw new Error('The archive data exceeds 20 MiB.');
    return true;
  } });
  if (!files['export.data'] || !files['export.attributes']) throw new Error('Choose a 1Password .1pux export.');
  const attrs = JSON.parse(strFromU8(files['export.attributes']));
  if (attrs.version !== 3) throw new Error('Only 1PUX version 3 is supported.');
  const data = JSON.parse(strFromU8(files['export.data']));
  if (!Array.isArray(data.accounts)) throw new Error('Invalid 1PUX account list.');
  const entries: PasswordEntry[] = [], warnings: string[] = [];
  for (const account of data.accounts) for (const vault of account.vaults ?? []) for (const item of vault.items ?? []) {
    if (entries.length >= MAX_ROWS) throw new Error('Import at most 2,000 entries at a time.');
    // Optional vendor extension preserves ordered fields and native passkeys
    // on a Thingtime round trip. Other 1PUX readers use the standard fields.
    if (item.details?.thingtime?.version === 1) {
      entries.push(validatePasswordEntry(item.details.thingtime.entry)); continue;
    }
    const entry = emptyPasswordEntry(), details = item.details ?? {}, overview = item.overview ?? {};
    entry.title = textValue(overview.title) || 'Imported entry';
    entry.passwordType = item.categoryUuid === '003' ? 'secure-note' : item.categoryUuid === '005' ? 'password' : 'login';
    let sequence = 0;
    const add = (label: string, type: FieldType, value: unknown) => { entry.fields.push({ id: `import-${++sequence}`, label: label || 'Custom field', type, value: textValue(value) }); };
    for (const field of details.loginFields ?? []) {
      if (['username', 'password'].includes(field.designation)) entry.fields.find(f => f.id === field.designation)!.value = textValue(field.value);
      else if (field.value) add(field.name || 'Form field', (field.fieldType || field.type) === 'P' ? 'password' : 'text', field.value);
    }
    if (details.password && !entry.fields[1].value) entry.fields[1].value = textValue(details.password);
    entry.fields[2].value = textValue(overview.url || overview.urls?.[0]?.url);
    if (details.notesPlain) entry.fields.push({ id: 'notes', label: 'Notes', type: 'notes', value: textValue(details.notesPlain) });
    for (const section of details.sections ?? []) for (const field of section.fields ?? []) {
      const value = field.value ?? {}, type: FieldType = 'totp' in value ? 'totp' : 'concealed' in value ? 'password' : 'url' in value ? 'url' : 'email' in value ? 'email' : 'text';
      const scalar = value.totp ?? value.concealed ?? value.string ?? value.url ?? value.email ?? value;
      add([section.title, field.title].filter(Boolean).join(' · ') || 'Custom field', type, scalar);
    }
    for (const url of overview.urls ?? []) if (url.url && url.url !== entry.fields[2].value) add(url.label || 'Additional website', 'url', url.url);
    if (overview.tags?.length) add('Tags', 'text', overview.tags.join(', '));
    if (item.state === 'archived') add('Imported state', 'text', 'Archived in 1Password');
    if (details.passwordHistory?.length) warnings.push('Password history is not imported. Current passwords are preserved.');
    if (details.documentAttributes || item.file) warnings.push('Document attachments are not imported. Keep the original export until you have transferred them.');
    try { entries.push(validatePasswordEntry(entry)); } catch { throw new Error(`1PUX item ${entries.length + 1} exceeds the entry limits.`); }
  }
  if (omittedFiles) warnings.push('Archive files and icons are not imported.');
  warnings.push('1Password desktop exports do not include transferable passkey private keys.');
  return { entries, warnings: [...new Set(warnings)] };
}
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
export function exportPasswords(entries: PasswordEntry[], format: PasswordFormat): { bytes: Uint8Array; extension: string; mime: string } {
  if (entries.length > MAX_ROWS) throw new Error('Export at most 2,000 entries per file.');
  entries.forEach(validatePasswordEntry);
  if (format === '1pux') {
    const now = Math.floor(Date.now() / 1000);
    const data = { accounts: [{ attrs: { accountName: 'Thingtime', name: 'Thingtime', uuid: crypto.randomUUID(), domain: 'https://thingtime.com' }, vaults: [{ attrs: { uuid: crypto.randomUUID(), name: 'Passwords', desc: '', type: 'P' }, items: entries.map(entry => ({
      uuid: crypto.randomUUID(), favIndex: 0, createdAt: now, updatedAt: now, state: 'active', categoryUuid: entry.passwordType === 'secure-note' ? '003' : entry.passwordType === 'password' ? '005' : '001',
      overview: { title: entry.title, url: passwordFieldValue(entry, 'website'), urls: entry.fields.filter(field => field.type === 'url' && field.value).map(field => ({ label: field.label, url: field.value })), tags: [] },
      details: { thingtime: { version: 1, entry }, loginFields: ['username', 'password'].map(id => ({ designation: id, name: id, fieldType: id === 'password' ? 'P' : 'T', value: passwordFieldValue(entry, id) })), notesPlain: passwordFieldValue(entry, 'notes'), sections: [{ title: 'Custom fields', name: 'custom', fields: entry.fields.filter(field => !['username', 'password', 'website', 'notes'].includes(field.id)).map(field => ({ id: field.id, title: field.label, value: { [field.type === 'password' ? 'concealed' : field.type === 'totp' ? 'totp' : field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : 'string']: field.value } })) }] }
    })) }] }] };
    return { bytes: zipSync({ 'export.attributes': strToU8(JSON.stringify({ version: 3, description: '1Password Unencrypted Export', createdAt: now })), 'export.data': strToU8(JSON.stringify(data)) }), extension: '1pux', mime: 'application/zip' };
  }
  const header = format === 'chrome' ? ['name', 'url', 'username', 'password', 'note'] : format === 'apple' ? ['Title', 'URL', 'Username', 'Password', 'Notes', 'OTPAuth'] : ['Title', 'Website', 'Username', 'Password', 'One-time password', 'Favorite', 'Archived', 'Tags', 'Notes'];
  const rows = entries.map(entry => {
    const common = [entry.title, passwordFieldValue(entry, 'website'), passwordFieldValue(entry, 'username'), passwordFieldValue(entry, 'password')], notes = passwordFieldValue(entry, 'notes'), otp = entry.fields.find(field => field.type === 'totp')?.value || '';
    return format === 'chrome' ? [...common, notes] : format === 'apple' ? [...common, notes, otp] : [...common, otp, 'false', 'false', '', notes];
  });
  return { bytes: strToU8([header, ...rows].map(row => row.map(quote).join(',')).join('\r\n')), extension: 'csv', mime: 'text/csv;charset=utf-8' };
}

// Each part stays below the same limits used by import, including the expanded
// 1PUX JSON. A large vault downloads as one ZIP containing independently
// importable files, never an archive which this manager cannot restore.
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
