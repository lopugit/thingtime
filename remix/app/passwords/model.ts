export const PASSWORD_ENTRY_KIND = 'password-manager-entry';
export const PASSWORD_TYPES = ['login', 'password', 'api-key', 'secure-note', 'passkey-reference', 'passkey', 'credit-card', 'identity', 'document', 'software-license', 'bank-account', 'database', 'driver-license', 'outdoor-license', 'membership', 'passport', 'rewards', 'social-security-number', 'email-account', 'server', 'wireless-router', 'ssh-key', 'api-credential', 'medical-record', 'other'] as const;
export const FIELD_TYPES = ['text', 'password', 'url', 'email', 'notes', 'totp', 'address', 'credit-card-number', 'credit-card-type', 'date', 'gender', 'menu', 'month-year', 'phone', 'reference', 'ssh-key', 'structured'] as const;
export type PasswordType = typeof PASSWORD_TYPES[number];
export type FieldType = typeof FIELD_TYPES[number];
export type PasswordField = { id: string; label: string; type: FieldType; value: string; section?: string; concealed?: boolean; multiline?: boolean; structured?: boolean; sourcePath?: (string | number)[] };
export type PasswordEntry = { title: string; passwordType: PasswordType; fields: PasswordField[]; onePassword?: string; onePasswordContext?: string; categoryId?: string; tags?: string[]; archived?: boolean; favorite?: boolean; importArchiveId?: string };
export type PasswordMetadata = { id: string; title: string; passwordType: PasswordType; revision: number; updatedAt: string };

export const validPasswordId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
export function emptyPasswordEntry(): PasswordEntry {
  return { title: '', passwordType: 'login', fields: [
    { id: 'username', label: 'Username', type: 'text', value: '' },
    { id: 'password', label: 'Password', type: 'password', value: '' },
    { id: 'website', label: 'Website', type: 'url', value: '' }
  ] };
}
export function validatePasswordEntry(value: unknown): PasswordEntry {
  const input = value as PasswordEntry;
  if (!input || typeof input !== 'object' || typeof input.title !== 'string' || !input.title.trim() ||
    !PASSWORD_TYPES.includes(input.passwordType) || !Array.isArray(input.fields))
    throw new Error('Enter a title, a password type, and a fields list.');
  const ids = new Set<string>();
  const fields = input.fields.map(field => {
    if (!field || typeof field.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(field.id) || ['__proto__', 'constructor', 'prototype'].includes(field.id) ||
      ids.has(field.id) || typeof field.label !== 'string' || !field.label.trim() ||
      !FIELD_TYPES.includes(field.type) || typeof field.value !== 'string')
      throw new Error('Every field needs a unique id, a label, a supported type, and a text value.');
    ids.add(field.id);
    const extra: Partial<PasswordField> = {};
    for (const key of ['concealed', 'multiline', 'structured'] as const) if (field[key] !== undefined) { if (typeof field[key] !== 'boolean') throw new Error('Invalid field presentation.'); extra[key] = field[key]; }
    if (field.section !== undefined) { if (typeof field.section !== 'string') throw new Error('Invalid section.'); extra.section = field.section; }
    if (field.structured) { try { JSON.parse(field.value || 'null'); } catch { throw new Error('Structured fields must contain valid JSON.'); } }
    if (field.sourcePath !== undefined) {
      if (!Array.isArray(field.sourcePath) || !field.sourcePath.length || field.sourcePath.some(key => !((typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key)) || (Number.isSafeInteger(key) && Number(key) >= 0)))) throw new Error('Invalid imported field path.');
      extra.sourcePath = [...field.sourcePath];
    }
    return { id: field.id, label: field.label.trim(), type: field.type, value: field.value, ...extra };
  });
  const result: PasswordEntry = { title: input.title.trim(), passwordType: input.passwordType, fields };
  if (input.onePassword !== undefined) {
    if (typeof input.onePassword !== 'string') throw new Error('Invalid source item.');
    try { const parsed = JSON.parse(input.onePassword); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); } catch { throw new Error('Invalid source item.'); }
    result.onePassword = input.onePassword;
  }
  if (input.onePasswordContext !== undefined) { if (typeof input.onePasswordContext !== 'string') throw new Error('Invalid source context.'); try { JSON.parse(input.onePasswordContext); } catch { throw new Error('Invalid source context.'); } result.onePasswordContext = input.onePasswordContext; }
  if (input.categoryId !== undefined) { if (typeof input.categoryId !== 'string') throw new Error('Invalid category.'); result.categoryId = input.categoryId; }
  if (input.tags !== undefined) { if (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== 'string')) throw new Error('Invalid tags.'); result.tags = [...input.tags]; }
  for (const key of ['archived', 'favorite'] as const) if (input[key] !== undefined) { if (typeof input[key] !== 'boolean') throw new Error('Invalid item state.'); result[key] = input[key]; }
  if (input.importArchiveId !== undefined) { if (!validPasswordId(input.importArchiveId)) throw new Error('Invalid source archive.'); result.importArchiveId = input.importArchiveId; }
  return result;
}
export const passwordFieldValue = (entry: PasswordEntry, id: string) => entry.fields.find(field => field.id === id)?.value ?? '';
