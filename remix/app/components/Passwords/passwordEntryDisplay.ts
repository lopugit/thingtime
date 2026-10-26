import { PASSWORD_TYPES, type PasswordEntry } from '~/passwords/model';
import { passwordFieldIsSecret, passwordProperties } from '~/passwords/structuredFields';

/** Deliberate display projection: decrypted values, source archives and field
 * source paths are excluded before any ComponentDataScope is created. */
export function passwordEntryDisplay(entry: PasswordEntry | undefined, revealed: Record<string, boolean> = {}, copyFeedback: Record<string, string> = {}, rawFields: Record<string, boolean> = {}) {
  return {
    type: entry?.passwordType || 'login',
    passkey: entry?.passwordType === 'passkey', passkeyReference: entry?.passwordType === 'passkey-reference',
    favorite: entry?.favorite === true, archived: entry?.archived === true,
    types: PASSWORD_TYPES.filter(type => type !== 'passkey' || entry?.passwordType === 'passkey').map(value => ({ value, label: value.replace(/-/g, ' ') })),
    fields: (entry?.fields || []).map((field, index, fields) => {
      const properties = passwordProperties(field);
      const secret = passwordFieldIsSecret(field) || Boolean(properties?.some(property => property.secret)) || Boolean(field.structured && (!properties || rawFields[field.id]));
      const structured = Boolean(properties && !rawFields[field.id]);
      const multiline = Boolean((field.multiline || ['notes', 'address', 'structured', 'ssh-key'].includes(field.type)) && (!secret || revealed[field.id]));
      return { id: field.id, label: field.label, section: field.section !== fields[index - 1]?.section ? field.section || '' : '',
        structured, canStructure: Boolean(properties), modeLabel: structured ? 'Edit JSON' : 'Edit individual properties',
        properties: structured ? properties!.map(property => {
          const masked = property.secret && !revealed[field.id];
          const boolean = property.kind === 'boolean' && !property.secret;
          const multiline = property.multiline && !masked;
          return { id: field.id, path: property.path, name: `property-${field.id}-${property.path}`, labelName: `property-label-${field.id}-${property.path}`,
            boolean, multiline, single: !boolean && !multiline, readOnly: ['null', 'object', 'array'].includes(property.kind),
            inputType: masked ? 'password' : 'text', inputMode: property.kind === 'number' ? 'decimal' : 'text',
            required: property.kind === 'number',
            typeLabel: property.kind === 'null' ? 'Null value; use JSON to change its type.' : ['array', 'object'].includes(property.kind) ? `Empty ${property.kind}; use JSON to add properties.` : property.kind };
        }) : [],
        copyable: entry?.passwordType !== 'passkey', copyLabel: field.type === 'totp' ? 'Copy verification code' : 'Copy', copyAccessibleLabel: field.type === 'totp' ? 'Copy current verification code' : `Copy ${field.label}`, copyFeedback: copyFeedback[field.id] || '',
        secret: secret || Boolean(properties?.some(property => property.secret)), multiline: !structured && multiline, single: !structured && !multiline, inputType: secret && !revealed[field.id] ? 'password' : 'text',
        inputMode: field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text',
        revealLabel: revealed[field.id] ? 'Hide' : 'Show', first: index === 0, last: index === fields.length - 1, totp: field.type === 'totp' };
    })
  };
}
