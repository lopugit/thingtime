import { SOURCE_REFRESH_MODES, type SourceRefreshMode } from '../components/ComponentsLibrary/componentBrowseTypes';
export type ComponentSourceDraft = { action: string; refresh: SourceRefreshMode; intervalMs: string; inputs: string };
export function restoreComponentSourceDraft(snapshot: string): { draft: ComponentSourceDraft; binding: string } {
 const value = JSON.parse(snapshot), draft = value?.draft;
 if (typeof value?.binding !== 'string' || value.binding.length > 128 * 1024 || !draft || typeof draft !== 'object' ||
  !['action','intervalMs','inputs'].every(key => typeof draft[key] === 'string' && draft[key].length <= 128 * 1024) || !SOURCE_REFRESH_MODES.includes(draft.refresh))
  throw new Error('This source-control draft cannot be restored. Its saved copy has been kept.');
 return { binding: value.binding, draft: { action: draft.action, intervalMs: draft.intervalMs, inputs: draft.inputs, refresh: draft.refresh } };
}
