import type { ComponentArgValues } from '../components/ComponentsLibrary/componentTemplate';
export type ComponentVersionDraft = { values: ComponentArgValues; name: string; acl: string[] };
export function restoreComponentVersionDraft(snapshot: string): ComponentVersionDraft {
 const value = JSON.parse(snapshot);
 if (!value || typeof value.name !== 'string' || !value.values || typeof value.values !== 'object' || Array.isArray(value.values)
  || Object.keys(value.values).length > 256 || Object.values(value.values).some(v => !['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v)))
  || !Array.isArray(value.acl) || value.acl.some(v => typeof v !== 'string')) throw new Error('This component draft cannot be restored. Its saved copy has been kept.');
 return { values: value.values, name: value.name, acl: value.acl };
}
