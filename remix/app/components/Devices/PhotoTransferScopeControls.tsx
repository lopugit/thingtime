import React from 'react';
import type { FolderRequest, FolderResult } from '~/fileSync/mobileFolders.client';
import type { ConfigurationDraft } from '~/fileSync/configurationEditor';
import { DEFAULT_PHOTO_AUTOMATION } from '~/fileSync/configuration';
import { type PhotoTransferPolicy } from '~/fileSync/photoTransferPolicy';
import { PhotoAutomationControls, photoUploadSaveBlocks } from './PhotoAutomationControls';
import { SyncEditorBlocks } from './SyncEditorBlocks';
import type { SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';

type Props = { generalUploads?: boolean; supported: boolean; ownerId: string; deviceId: string; rootId?: string; scopeKey: string;
 accountTransport?: SettingsDocumentHostProps['accountTransport'];
 request(owner: string, request: FolderRequest, signal: AbortSignal): Promise<FolderResult>;
 assertCurrent(): void;
 onSaved?(policy: PhotoTransferPolicy): void;
};
/** Persist at the native device/folder scope, never duplicate policy into configs. */
export function PhotoTransferScopeControls({ generalUploads = false, supported, ownerId, deviceId, rootId, scopeKey, accountTransport, request, assertCurrent, onSaved }: Props) {
 const [policy, setPolicy] = React.useState<PhotoTransferPolicy>();
 const [draft, setDraft] = React.useState<ConfigurationDraft['photoAutomationDraft']>();
 const [candidate, setCandidate] = React.useState<PhotoTransferPolicy>();
 const [valid, setValid] = React.useState(true), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
 const guard = React.useRef(assertCurrent); guard.current = assertCurrent;
 const saved = React.useRef(onSaved); saved.current = onSaved;
 const abort = React.useRef<AbortController | undefined>(undefined);
 const load = async () => {
  if (!supported) return;
  const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
  setBusy(true); setError('');
  try {
   guard.current();
   const result = await request(ownerId, generalUploads ? { action: 'read-upload-policy', deviceId, rootId } : { action: 'read-photo-transfer-policy', deviceId, rootId }, controller.signal);
   controller.signal.throwIfAborted(); guard.current();
   const policy = generalUploads ? result.uploadPolicy : result.photoTransferPolicy;
   if (!policy) throw Error('The device did not return its upload policy.');
   setPolicy(policy); saved.current?.(policy);
  } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load upload settings.'); }
  finally { if (!controller.signal.aborted) setBusy(false); }
 };
 // The parent keys this session by origin, owner, device and root.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 React.useEffect(() => { void load(); return () => abort.current?.abort(); }, [scopeKey]);
 const save = async () => {
  if (!candidate || !valid || busy) return;
  const controller = new AbortController(); abort.current?.abort(); abort.current = controller; setBusy(true); setError('');
  try {
   guard.current();
   const result = await request(ownerId, generalUploads ? { action: 'set-upload-policy', deviceId, rootId, uploadPolicy: candidate } : { action: 'set-photo-transfer-policy', deviceId, rootId, photoTransferPolicy: candidate }, controller.signal);
   controller.signal.throwIfAborted(); guard.current();
   const policy = generalUploads ? result.uploadPolicy : result.photoTransferPolicy;
   if (!policy) throw Error('The device did not acknowledge upload settings.');
   setPolicy(policy); setDraft(undefined); setCandidate(undefined); saved.current?.(policy);
  } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not save upload settings.'); }
  finally { if (!controller.signal.aborted) setBusy(false); }
 };
 return <section aria-label={rootId ? 'Folder upload settings' : 'Device upload settings'}>
  <PhotoAutomationControls generalUploads={generalUploads} transferScope={rootId ? 'folder' : 'device'} policy={{ ...policy, notificationIntervalMs: DEFAULT_PHOTO_AUTOMATION.notificationIntervalMs }}
   draft={draft} disabled={!supported || busy || policy === undefined} availability={!supported ? 'Update Thingtime on this iPhone to manage shared device and folder upload limits.' : error || (policy === undefined ? '' :
    `${rootId ? (generalUploads ? 'Shared across uploads from every backup config in this folder.' : 'Shared across every Photos sync config in this folder.') : (generalUploads ? 'Shared across folder and Photos uploads on this device.' : 'Shared across every Photos backup on this device.')} Changes apply at the next upload admission; already-started uploads may finish.`)}
   scopeKey={scopeKey} accountTransport={accountTransport} onValidityChange={setValid} onChange={(next, parsed) => {
    setDraft(next); setCandidate(parsed ? { uploadBytesPerSecond: parsed.uploadBytesPerSecond, uploadBytesPerHour: parsed.uploadBytesPerHour } : undefined);
   }} />
  <SyncEditorBlocks documentKey="photo-backup-visible-limit-actions" title="Save upload settings" blocks={photoUploadSaveBlocks}
   scopeKey={scopeKey} accountTransport={accountTransport} scope={{ limits: { label: error && !candidate ? 'Retry loading upload settings' : 'Save upload settings', disabled: !supported || busy || !valid || (!candidate && !error), status: !supported ? 'Update required' : busy ? 'Saving or reading upload settings…' : draft ? 'Unsaved upload settings' : error ? 'Upload settings unavailable' : 'Saved upload settings' } }}
   actions={{ save: () => candidate ? save() : load() }} />
 </section>;
}
