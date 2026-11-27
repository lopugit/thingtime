import { ContextActionDock } from '../IncomingShare/ContextActionDock';
import React from 'react';
import localforage from 'localforage';
import { useSearchParams } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useAttachmentUploads } from '../Attachments/useAttachmentUploads';
import { ThingsPage } from './ThingsPage';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '~/utils/dataPlane';
import { fingerprintSource, equalContentFingerprints } from '~/fileSync/contentFingerprint';
import { readAttachmentSlice } from '../Attachments/attachmentFileSource';
import { parseCloudFileCommit, type CloudFileCommit } from '~/fileSync/cloudFile';
import { makeStableShareSavePlan, shareParentId, shareTextCrystal, validateShareSavePlan, shareFilesNeedingUpload, type ShareSavePlan } from './shareSavePlan';

const journal = localforage.createInstance({ name: 'thingtime-incoming-share', storeName: 'saves' });
const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': JSON.stringify({ operation }) });
const saveBlocks: WebpageBlock[] = [{ id: 'share-save-controls', type: 'element', tag: 'section', props: { 'aria-label': 'Save shared items' }, css: { display: 'grid', gap: 'var(--tt-context-card-gap, 12px)', padding: 'var(--tt-context-card-padding, 16px)', background: 'var(--tt-card, #fff)', border: '1px solid var(--tt-border, #ececef)', 'border-radius': '12px' }, children: [
 { id: 'share-save-location', type: 'element', tag: 'p', text: '{save.location}', css: { margin: '0', 'font-weight': '600', 'overflow-wrap': 'anywhere' } },
 { id: 'share-save-status', type: 'element', tag: 'p', text: '{save.status}', props: { role: 'status', 'aria-live': 'polite', style: { display: '{save.statusDisplay}' } }, css: { margin: '0', 'min-height': '20px', 'font-size': '13px', 'overflow-wrap': 'anywhere' } },
 { id: 'share-save-button', type: 'element', tag: 'button', text: 'Save here', props: { type: 'button', disabled: '{save.disabled}', 'aria-busy': '{save.busy}', ...action('save') }, css: { 'min-height': '48px', width: '100%', 'border-radius': '10px', border: '0', background: 'var(--tt-accent, #e24697)', color: 'var(--tt-accent-contrast, #fff)', 'font-weight': '650', cursor: 'pointer' } },
 { id: 'share-save-retry', type: 'element', tag: 'button', text: 'Retry attachments', props: { type: 'button', style: { display: '{save.retryDisplay}' }, ...action('retry') }, css: { 'min-height': '44px', background: 'transparent', color: 'inherit', border: '1px solid var(--tt-border, #ececef)', 'border-radius': '10px' } }
]}];
export type ShareSaveDestinationProps = { active?: boolean; toolbarHeight?: number; shareId: string; text: string; files: File[]; directories?: string[]; onSaved: (ids: string[]) => void | Promise<void>;
 beforeSubmit?: (targetId: string, operationId: string, payload: Record<string, unknown>) => Promise<void>;
 initialSubmission?: { targetId: string; operationId: string; recoveryPayload: string };
};
export function ShareSaveDestination(props: ShareSaveDestinationProps) {
 const user = useCurrentUser();
 const plane = useDataPlane();
 if (user && plane !== 'home') return <p role="status">Saving files requires your home Things storage. Your shared content is retained; select home storage before saving.</p>;
 return user ? <ShareSaveSession key={`${user.id}:${window.location.origin}:${props.shareId}`} {...props} ownerId={user.id} /> : null;
}
function ShareSaveSession({ active = true, toolbarHeight = 120, shareId, text, files, directories = [], onSaved, beforeSubmit, initialSubmission, ownerId }: ShareSaveDestinationProps & { ownerId: string }) {
 const api = useApi(); const apiRef = React.useRef(api); apiRef.current = api;
 const origin = window.location.origin;
 const scope = { ownerId, apiOrigin: origin, dataPlane: 'home' };
 const key = `${origin}:${ownerId}:${shareId}`;
 const [, setParams] = useSearchParams();
 const [location, setLocation] = React.useState({ id: null as string | null, name: 'All things' });
 const [plan, setPlan] = React.useState<ShareSavePlan | null>(null);
 const [error, setError] = React.useState(''); const [busy, setBusy] = React.useState(false);
 const [ready, setReady] = React.useState(false); const [saved, setSaved] = React.useState(0);
 const running = React.useRef(false), lifetime = React.useRef(new AbortController());
 const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);
 const admittedFiles = React.useRef(new Set<File>());
 const user = useCurrentUser();
 const uploadsAllowed = user?.privateUploadsEnabled !== false;
 const uploads = useAttachmentUploads(ownerId, setError, setError, true, undefined, { purpose: 'file', selectionScope: 'transfer' });
 const uploadsRef = React.useRef(uploads); uploadsRef.current = uploads;
 React.useEffect(() => {
  const controller = new AbortController(); lifetime.current = controller;
  void (async () => {
   const persisted = await journal.getItem<ShareSavePlan>(key);
   controller.signal.throwIfAborted();
   const native = initialSubmission ? JSON.parse(initialSubmission.recoveryPayload) as { plan: ShareSavePlan; commands: CloudFileCommit[] } : null;
   if (native && (initialSubmission!.operationId !== shareId || (native.plan.folderId || 'root') !== initialSubmission!.targetId || !Array.isArray(native.commands))) throw Error('The interrupted save destination does not match this share.');
   const stored = validateShareSavePlan(native?.plan || persisted || await makeStableShareSavePlan(origin, ownerId, shareId, null, text, files, directories), shareId, files, text, directories);
   controller.signal.throwIfAborted();
   let recoveredAny = Boolean(persisted || native);
   let rootPinned = recoveredAny;
   const pinRoot = (folderId: string | null) => {
    if (rootPinned && stored.folderId !== folderId) throw Error('The original shared items no longer have one destination.');
    stored.folderId = folderId; rootPinned = true; recoveredAny = true;
   };
   const requestOptions = { expectedActor: ownerId, expectedApiOrigin: origin, expectedDataPlane: 'home', signal: controller.signal };
   const getThing = async (id: string) => {
    try { return (await apiRef.current.v1.things.get({ id }, requestOptions)).thing; }
    catch (failure) { if ((failure as { status?: number }).status === 404) return null; throw failure; }
   };
   // Directory/text-only shares also recover their destination across hosts.
   for (const folder of stored.folders) {
    const existing = await getThing(folder.id); controller.signal.throwIfAborted();
    if (!existing) continue;
    if (existing.author?.id !== ownerId || !existing.thingtime?.includes('folder') || existing.crystal?.name !== folder.path.split('/').at(-1)) throw Error('A saved shared folder changed.');
    if (!folder.path.includes('/')) pinRoot(existing.folderId ?? null);
    else if ((existing.folderId ?? null) !== shareParentId(stored, folder.path)) throw Error('The original shared hierarchy changed.');
    recoveredAny = true;
   }
   if (stored.text) {
    const note = await getThing(stored.noteId); controller.signal.throwIfAborted();
    if (note) {
     const expected = shareTextCrystal(stored.text);
     if (note.author?.id !== ownerId || !note.thingtime?.includes('data') || note.crystal?.name !== expected.name || note.crystal?.text !== expected.text || JSON.stringify(note.crystal?.renderComponent) !== JSON.stringify(expected.renderComponent)) throw Error('The saved shared text changed.');
     pinRoot(note.folderId ?? null);
    }
   }
   const commands = new Map<string, CloudFileCommit>();
   for (const item of stored.files) {
    const nativeCommand = native?.commands.find(command => command.id === item.id);
    const command = nativeCommand || await journal.getItem<CloudFileCommit>(`${key}:file:${item.id}`);
    controller.signal.throwIfAborted();
    if (command) {
     const valid = parseCloudFileCommit(command);
     if (valid.id !== item.id || valid.operationId !== item.operationId || valid.name !== item.path.split('/').at(-1) || valid.folderId !== shareParentId(stored, item.path)) throw Error('The saved file command has a different destination.');
     commands.set(item.id, valid); await journal.setItem(`${key}:file:${item.id}`, valid); continue;
    }
    let existing;
    try { existing = await apiRef.current.v1.files.read(scope, item.id, { signal: controller.signal }); }
    catch (failure) { if ((failure as { status?: number }).status !== 404) throw failure; }
    controller.signal.throwIfAborted();
    if (!existing) continue;
    const index = stored.files.indexOf(item), file = files[index];
    if (existing.name !== item.path.split('/').at(-1) || existing.trashed || existing.content.size !== file.size) throw Error('A saved shared file changed. It has been retained for review.');
    const fingerprint = await fingerprintSource({ size: file.size, check: () => controller.signal.throwIfAborted(), read: async (offset, length, signal) => new Uint8Array(await (await readAttachmentSlice(file, offset, offset + length, signal)).arrayBuffer()) }, { signal: controller.signal });
    if (!equalContentFingerprints(existing.content.fingerprint, fingerprint)) throw Error('The saved file bytes differ from this share.');
    if (item.path.includes('/')) {
     if (existing.folderId !== shareParentId(stored, item.path)) throw Error('The saved shared hierarchy changed.');
    } else pinRoot(existing.folderId);
    const recovered: CloudFileCommit = { id: item.id, operationId: item.operationId, expectedRevision: null, name: existing.name, folderId: existing.folderId, attachmentId: existing.content.attachmentId, contentVersion: existing.content.version, trashed: false };
    commands.set(item.id, recovered); await journal.setItem(`${key}:file:${item.id}`, recovered); recoveredAny = true;
   }
   if (recoveredAny) {
    controller.signal.throwIfAborted(); await journal.setItem(key, stored);
    controller.signal.throwIfAborted(); setPlan(stored);
    setParams(previous => { const next = new URLSearchParams(previous); if (stored.folderId) next.set('folder', stored.folderId); else next.delete('folder'); return next; }, { replace: true });
   }
   const missing = shareFilesNeedingUpload(stored, files, commands);
   controller.signal.throwIfAborted(); setPendingFiles(missing); setReady(true);
  })().catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not prepare this share.'); });
  return () => controller.abort();
 // The session key owns an immutable native batch and its account identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [key]);
 React.useEffect(() => {
  if (!ready || !uploadsAllowed || lifetime.current.signal.aborted) return;
  const missing = pendingFiles.filter(file => !admittedFiles.current.has(file));
  for (const file of missing) admittedFiles.current.add(file);
  if (missing.length) uploadsRef.current.addFiles(missing);
 }, [ready, uploadsAllowed, pendingFiles]);
 const locationPicker = React.useMemo(() => ({ onLocationChange: (id: string | null, name: string) => setLocation(previous => previous.id === id && previous.name === name ? previous : { id, name }) }), []);
 const save = async () => {
  if (running.current || !ready || uploads.snapshot.blocking) return;
  running.current = true; setBusy(true); setError('');
  const signal = lifetime.current.signal;
  const options = { expectedActor: ownerId, expectedApiOrigin: origin, expectedDataPlane: 'home' as const, signal };
  const check = () => { signal.throwIfAborted(); if (window.location.origin !== origin) throw Error('The selected account or origin changed.'); };
  try {
   const current = plan || await makeStableShareSavePlan(origin, ownerId, shareId, location.id, text, files, directories);
   if (plan && location.id !== plan.folderId) throw Error('Finish the interrupted save in its original location before choosing another destination.');
   validateShareSavePlan(current, shareId, files, text, directories);
   if (current.text) await requireThingtimeCapability('api.things', '1.50.0', origin);
   check();
   // Persist before the first write. No side effect occurs if recovery storage fails.
   await journal.setItem(key, current); check(); setPlan(current);
   const ids: string[] = [];
   const getThing = async (id: string) => {
    try { return (await apiRef.current.v1.things.get({ id }, options))?.thing || null; }
    catch (failure) { if ((failure as { status?: number }).status === 404) return null; throw failure; }
   };
   const ensureThing = async (id: string, kind: string, crystal: Record<string, unknown>, folderId: string | null) => {
    check(); let thing = await getThing(id); check();
    if (!thing) {
     try { await apiRef.current.v1.things.create({ shareId: id, thingtime: [kind], crystal, folderId, visibility: 'private' }, options); }
     catch (failure) { thing = await getThing(id); if (!thing) throw failure; }
     thing ||= await getThing(id); check();
    }
    if (!thing || thing.id !== id || thing.author?.id !== ownerId || thing.folderId !== folderId || !thing.thingtime?.includes(kind) || thing.crystal?.name !== crystal.name || (kind === 'data' && (thing.crystal?.text !== crystal.text || JSON.stringify(thing.crystal?.renderComponent) !== JSON.stringify(crystal.renderComponent)))) throw Error('The saved item no longer matches this share. It has been kept for review.');
    ids.push(id); setSaved(ids.length);
   };
   const prepared = new Map<string, CloudFileCommit>();
   for (const [index, item] of current.files.entries()) {
    check(); const commandKey = `${key}:file:${item.id}`;
    let command = await journal.getItem<CloudFileCommit>(commandKey);
    if (!command) {
     const selected = uploadsRef.current.uploads.find(upload => upload.sourceFile === files[index] || upload.file === files[index]);
     if (!selected?.attachment || selected.status !== 'ready') throw Error('Wait for every attachment to finish, then Save here.');
     await requireThingtimeCapability('api.attachment-content', '1.13.0', origin);
     const response = await fetch(new URL('/api/v1/attachments/content?' + new URLSearchParams({ id: selected.attachment.id, fingerprint: '1' }), origin), { credentials: 'same-origin', cache: 'no-store', signal, headers: { [EXPECTED_ACTOR_HEADER]: ownerId, [EXPECTED_DATA_PLANE_HEADER]: 'home' } });
     const proof = await response.json(); if (!response.ok || typeof proof.version !== 'string') throw Error('Could not verify the shared attachment.');
     command = { id: item.id, operationId: item.operationId, expectedRevision: null, name: item.path.split('/').at(-1)!, folderId: shareParentId(current, item.path), attachmentId: selected.attachment.id, contentVersion: proof.version, trashed: false };
     await journal.setItem(commandKey, command);
    }
    prepared.set(item.id, command);
   }
   check();
   await beforeSubmit?.(current.folderId || 'root', shareId, { plan: current, commands: [...prepared.values()] }); check();
   for (const folder of current.folders) await ensureThing(folder.id, 'folder', { name: folder.path.split('/').at(-1) }, shareParentId(current, folder.path));
   for (const item of current.files) {
    const command = prepared.get(item.id)!;
    // An uncertain commit must retain its uploaded bytes until reconciled.
    uploadsRef.current.markCommitted([command.attachmentId]); check();
    await apiRef.current.v1.files.commit(scope, command, { signal });
    const result = await apiRef.current.v1.files.read(scope, command.id, { signal }); check();
    if (result.id !== command.id || result.name !== command.name || result.folderId !== command.folderId || result.trashed || result.content.attachmentId !== command.attachmentId || result.content.version !== command.contentVersion) throw Error('The saved file changed before verification. It has been kept for review.');
    ids.push(result.id); setSaved(ids.length);
   }
   if (current.text) await ensureThing(current.noteId, 'data', shareTextCrystal(current.text), current.folderId);
   check(); await journal.setItem(`${key}:complete`, ids); check(); await onSaved(ids);
  } catch (failure) { if (!signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not finish saving. Retry keeps the same items.'); }
  finally { running.current = false; if (!signal.aborted) setBusy(false); }
 };
 const failedUploads = uploads.uploads.some(upload => upload.status === 'error');
 const pending = uploads.uploads.filter(upload => upload.status !== 'ready').length;
 const status = error || (!uploadsAllowed && pendingFiles.length ? 'Private file uploads need administrator approval. Shared files are retained; this view resumes when approval becomes available.' : busy ? `Saving… ${saved} items verified` : pending ? `${uploads.uploads.length - pending} of ${files.length} attachments ready` : 'Browse your things, create folders, then save in the current location.');
 return <section aria-label="Save as a Thing" style={{ minWidth: 0 }}>
  <ThingsPage locationPicker={locationPicker} />
  <ContextActionDock active={active} bottomOffset={toolbarHeight}><div style={{ padding: '8px 0', background: 'var(--tt-page-bg, #fff)' }}>
   <SettingsDocumentHost documentKey="incoming-share-save" defaultDocument={saveBlocks} scopeKey={key} title="Save shared items layout">
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={key} enabled={!editing} scope={{ save: { location: `Save in ${location.name}`, status, statusDisplay: error || busy || pending || (!uploadsAllowed && pendingFiles.length) ? 'block' : 'var(--tt-context-secondary-display, block)', busy, disabled: busy || !ready || (!uploadsAllowed && pendingFiles.length > 0) || uploads.snapshot.blocking || (!files.length && !text && !directories.length), retryDisplay: failedUploads ? 'block' : 'none' } }} actions={{ save, retry: () => { setError(''); uploads.retryAll(); } }}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} /></TransientBlockHost>}
   </SettingsDocumentHost>
  </div></ContextActionDock>
 </section>;
}
