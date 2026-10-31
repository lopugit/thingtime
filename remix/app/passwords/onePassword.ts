import { validatePasswordEntry, type PasswordEntry, type PasswordField, type FieldType } from './model';
// Numeric categories are part of the 1PUX contract; unfamiliar categories remain intact.
export const ONE_PASSWORD_CATEGORIES: Record<string, string> = { '001': 'login', '002': 'credit-card', '003': 'secure-note', '004': 'identity', '005': 'password', '006': 'document', '100': 'software-license', '101': 'bank-account', '102': 'database', '103': 'driver-license', '104': 'outdoor-license', '105': 'membership', '106': 'passport', '107': 'rewards', '108': 'social-security-number', '109': 'wireless-router', '110': 'server', '111': 'email-account', '112': 'api-credential', '113': 'medical-record', '114': 'ssh-key' };
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const text = (v: unknown) => typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
const fieldTypes: Record<string, FieldType> = { concealed: 'password', totp: 'totp', url: 'url', email: 'email', string: 'text', address: 'address', creditCardNumber: 'credit-card-number', creditCardType: 'credit-card-type', date: 'date', gender: 'gender', menu: 'menu', monthYear: 'month-year', phone: 'phone', reference: 'reference', sshKey: 'ssh-key' };
export function importOnePasswordItem(item: any): PasswordEntry {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid item.');
  if (item.details?.thingtime?.version === 1) return validatePasswordEntry(item.details.thingtime.entry);
  const details = item.details ?? {}, overview = item.overview ?? {}, fields: PasswordField[] = [];
  const add = (id: string, label: string, type: FieldType, value: unknown, extra: Partial<PasswordField> = {}) => fields.push({ id, label, type, value: text(value), ...extra });
  let sequence = 0;
  for (const [index, field] of (details.loginFields ?? []).entries()) {
    if (!field || typeof field !== 'object') continue;
    const designation = ['username', 'password'].includes(field.designation) && !fields.some(f => f.id === field.designation) ? field.designation : `import-${++sequence}`;
    add(designation, field.name || field.designation || 'Form field', (field.fieldType || field.type) === 'P' || field.designation === 'password' ? 'password' : 'text', field.value, { sourcePath: ['details', 'loginFields', index, 'value'] });
  }
  if (details.password !== undefined && !fields.some(f => f.id === 'password')) add('password', 'Password', 'password', details.password, { sourcePath: ['details', 'password'] });
  if (overview.url !== undefined) add('website', 'Website', 'url', overview.url, { sourcePath: ['overview', 'url'] });
  for (const [index, url] of (overview.urls ?? []).entries()) if (url && typeof url === 'object') add(`import-${++sequence}`, url.label || 'Website', 'url', url.url, { sourcePath: ['overview', 'urls', index, 'url'] });
  if (details.notesPlain !== undefined) add('notes', 'Notes', 'notes', details.notesPlain, { sourcePath: ['details', 'notesPlain'] });
  for (const [sectionIndex, section] of (details.sections ?? []).entries()) for (const [fieldIndex, field] of (section?.fields ?? []).entries()) {
    if (!field || typeof field !== 'object') continue;
    const value = field.value, keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
    const valueType = keys.length === 1 && !['__proto__', 'prototype', 'constructor'].includes(keys[0]) ? keys[0] : undefined;
    const raw = valueType ? value[valueType] : value;
    add(`import-${++sequence}`, field.title || field.id || 'Custom field', valueType && own(fieldTypes, valueType) ? fieldTypes[valueType] : 'structured', raw, {
      section: text(section.title || section.name), concealed: field.guarded === true || valueType === 'concealed' || valueType === 'sshKey',
      multiline: field.multiline === true || (raw !== null && typeof raw === 'object'), structured: typeof raw !== 'string',
      sourcePath: ['details', 'sections', sectionIndex, 'fields', fieldIndex, 'value', ...(valueType ? [valueType] : [])]
    });
  }
  return validatePasswordEntry({ title: text(overview.title) || 'Imported entry', passwordType: (Object.prototype.hasOwnProperty.call(ONE_PASSWORD_CATEGORIES, item.categoryUuid) ? ONE_PASSWORD_CATEGORIES[item.categoryUuid] : 'other'), fields,
    onePassword: JSON.stringify(item), categoryId: text(item.categoryUuid), tags: Array.isArray(overview.tags) ? overview.tags.map(text) : [], archived: item.state === 'archived', favorite: Number(item.favIndex) > 0 });
}
function atPath(root: any, path: (string | number)[]) {
  let value = root;
  for (const key of path) { if (!value || typeof value !== 'object' || !own(value, String(key))) return undefined; value = value[key]; }
  return value;
}
export function exportOnePasswordItem(entry: PasswordEntry) {
  const now = Math.floor(Date.now() / 1000);
  const item: any = entry.onePassword ? JSON.parse(entry.onePassword) : { uuid: crypto.randomUUID(), favIndex: 0, createdAt: now, updatedAt: now, state: 'active', overview: {}, details: {} };
  // Patch known values before removing array members, so source indices stay stable.
  for (const field of entry.fields) if (field.sourcePath) {
    const parentPath = field.sourcePath.slice(0, -1), target = atPath(item, parentPath);
    if (target && typeof target === 'object' && text(target[field.sourcePath.at(-1)!]) !== field.value) target[field.sourcePath.at(-1)!] = field.structured ? JSON.parse(field.value || 'null') : field.value;
    const path = field.sourcePath;
    if (path[1] === 'sections') {
      const original = atPath(item, path.slice(0, 5));
      if (original && field.label !== (original.title || original.id || 'Custom field')) original.title = field.label;
    } else if (path[1] === 'urls') { const original = atPath(item, path.slice(0, 3)); if (original && field.label !== (original.label || 'Website')) original.label = field.label; }
  }
  if (entry.onePassword) {
    const retained = new Set(entry.fields.flatMap(field => field.sourcePath ? [JSON.stringify(field.sourcePath)] : []));
    const removals = importOnePasswordItem(JSON.parse(entry.onePassword)).fields.filter(field => field.sourcePath && !retained.has(JSON.stringify(field.sourcePath))).map(field => {
      const path = field.sourcePath!;
      return path[1] === 'sections' ? path.slice(0, 5) : ['loginFields', 'urls'].includes(String(path[1])) ? path.slice(0, 3) : path;
    });
    // Descending indices keep deletions in the same array independent.
    removals.sort((a, b) => Number(b.at(-1)) - Number(a.at(-1)));
    for (const path of removals) {
      const parent = atPath(item, path.slice(0, -1)), key = path.at(-1)!;
      if (Array.isArray(parent) && typeof key === 'number') parent.splice(key, 1);
      else if (parent && typeof parent === 'object') delete parent[key];
    }
  }
  item.overview ??= {}; item.details ??= {};
  item.overview.title = entry.title;
  if (entry.tags) item.overview.tags = entry.tags;
  if (entry.archived !== undefined) item.state = entry.archived ? 'archived' : 'active';
  if (entry.favorite !== undefined) item.favIndex = entry.favorite ? (item.favIndex || 1) : 0;
  const originalType = entry.categoryId && own(ONE_PASSWORD_CATEGORIES, entry.categoryId) ? ONE_PASSWORD_CATEGORIES[entry.categoryId] : 'other';
  item.categoryUuid = entry.categoryId && originalType === entry.passwordType ? entry.categoryId : Object.keys(ONE_PASSWORD_CATEGORIES).find(key => ONE_PASSWORD_CATEGORIES[key] === entry.passwordType) || '001';
  const extra = entry.fields.filter(field => !field.sourcePath);
  const custom: PasswordField[] = [];
  for (const field of extra) {
    if (['username', 'password'].includes(field.id)) (item.details.loginFields ??= []).push({ name: field.label, designation: field.id, fieldType: field.id === 'password' ? 'P' : 'T', value: field.value });
    else if (field.id === 'website') item.overview.url = field.value;
    else if (field.id === 'notes') item.details.notesPlain = field.value;
    else custom.push(field);
  }
  for (const title of new Set(custom.map(field => field.section || 'Thingtime fields'))) {
    (item.details.sections ??= []).push({ title, name: crypto.randomUUID(), fields: custom.filter(field => (field.section || 'Thingtime fields') === title).map(field => ({ id: field.id, title: field.label, guarded: field.concealed || field.type === 'password', multiline: field.multiline || field.type === 'notes', value: { [Object.keys(fieldTypes).find(key => fieldTypes[key] === field.type) || 'string']: field.structured ? JSON.parse(field.value || 'null') : field.value } })) });
  }
  item.details.thingtime = { version: 1, entry };
  return item;
}
