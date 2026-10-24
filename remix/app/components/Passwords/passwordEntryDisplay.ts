import { PASSWORD_TYPES, type PasswordEntry } from '~/passwords/model';

/** Deliberate display projection: decrypted values, source archives and field
 * source paths are excluded before any ComponentDataScope is created. */
export function passwordEntryDisplay(entry: PasswordEntry | undefined, revealed: Record<string, boolean> = {}) {
  return {
    type: entry?.passwordType || 'login',
    passkey: entry?.passwordType === 'passkey', passkeyReference: entry?.passwordType === 'passkey-reference',
    favorite: entry?.favorite === true, archived: entry?.archived === true,
    types: PASSWORD_TYPES.filter(type => type !== 'passkey' || entry?.passwordType === 'passkey').map(value => ({ value, label: value.replace(/-/g, ' ') })),
    fields: (entry?.fields || []).map((field, index, fields) => {
      const secret = Boolean(field.concealed || ['password', 'totp', 'ssh-key', 'credit-card-number'].includes(field.type));
      const multiline = Boolean((field.multiline || ['notes', 'address', 'structured', 'ssh-key'].includes(field.type)) && (!secret || revealed[field.id]));
      return { id: field.id, label: field.label, section: field.section !== fields[index - 1]?.section ? field.section || '' : '',
        secret, multiline, single: !multiline, inputType: secret && !revealed[field.id] ? 'password' : 'text',
        inputMode: field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text',
        revealLabel: revealed[field.id] ? 'Hide' : 'Show', first: index === 0, last: index === fields.length - 1, totp: field.type === 'totp' };
    })
  };
}
