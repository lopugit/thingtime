export const PASSWORD_ENTRY_KIND = 'password-manager-entry';
export const PASSWORD_TYPES = ['login', 'password', 'api-key', 'secure-note', 'passkey-reference', 'passkey'] as const;
export const FIELD_TYPES = ['text', 'password', 'url', 'email', 'notes', 'totp'] as const;
export type PasswordType = typeof PASSWORD_TYPES[number];
export type FieldType = typeof FIELD_TYPES[number];
export type PasswordField = { id: string; label: string; type: FieldType; value: string };
export type PasswordEntry = { title: string; passwordType: PasswordType; fields: PasswordField[] };
export type PasswordMetadata = { id: string; title: string; passwordType: PasswordType; revision: number; updatedAt: string };
export const PASSWORD_MAX_BYTES = 48 * 1024;
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
  if (!input || typeof input !== 'object' || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160 ||
    !PASSWORD_TYPES.includes(input.passwordType) || !Array.isArray(input.fields) || input.fields.length > 64)
    throw new Error('Enter a title, a password type, and at most 64 fields.');
  const ids = new Set<string>();
  const fields = input.fields.map(field => {
    if (!field || typeof field.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(field.id) || ['__proto__', 'constructor', 'prototype'].includes(field.id) ||
      ids.has(field.id) || typeof field.label !== 'string' || !field.label.trim() || field.label.length > 120 ||
      !FIELD_TYPES.includes(field.type) || typeof field.value !== 'string' || field.value.length > 16_384)
      throw new Error('Every field needs a unique id, a label, a supported type, and a bounded value.');
    ids.add(field.id);
    return { id: field.id, label: field.label.trim(), type: field.type, value: field.value };
  });
  const result = { title: input.title.trim(), passwordType: input.passwordType, fields };
  if (new TextEncoder().encode(JSON.stringify(result)).length > PASSWORD_MAX_BYTES) throw new Error('This entry exceeds 48 KiB.');
  return result;
}
export const passwordFieldValue = (entry: PasswordEntry, id: string) => entry.fields.find(field => field.id === id)?.value ?? '';
