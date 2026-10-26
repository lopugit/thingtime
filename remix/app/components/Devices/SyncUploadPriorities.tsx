import React from 'react';
import { openSyncJournal } from '~/fileSync/journal.client';
import { sameSyncScope, syncPathKey, type SyncScope } from '~/fileSync/reconcile';
import { parseUploadPriorityDraft } from '~/fileSync/uploadPriorityEditor';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';

type Preferences = { revision: number; paths: string[] };
export type UploadPriorityDraftState = { saved?: Preferences; draft?: string };
export type UploadPriorityOptions = { scope: SyncScope; excludedPaths: string[]; ignoreRules?: string; draftState?: UploadPriorityDraftState;
 transport?: { read(signal: AbortSignal): Promise<Preferences>; save(paths: string[], expectedRevision: number, signal: AbortSignal): Promise<Preferences> } };
const action = (operation: string, inputs: Record<string, unknown> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const control = { 'min-height': '40px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', 'max-width': '100%', 'box-sizing': 'border-box' };
const button = (id: string, text: string, operation: string, inputs: Record<string, unknown> = {}): WebpageBlock => ({ id, type: 'element', tag: 'button', text,
 props: { type: 'button', disabled: '{priorities.disabled}', ...action(operation, inputs) }, css: control });
export const syncUploadPriorityBlocks: WebpageBlock[] = [{ id: 'sync-priorities', type: 'element', tag: 'section', props: { 'aria-label': 'Upload priorities' },
 css: { 'min-width': '0', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px', 'overflow-wrap': 'anywhere' }, children: [
 { id: 'priority-title', type: 'element', tag: 'h3', text: 'Upload these first', css: { 'font-weight': '600' } },
 { id: 'priority-help', type: 'element', tag: 'p', text: 'List files or folders relative to this connection, one per line, highest priority first. A folder includes its children. The current file finishes safely before the queue changes. Required parent folders upload first; exclusions still apply.' },
 { id: 'priority-label', type: 'element', tag: 'label', text: 'Priority paths', props: { for: '{priorities.inputId}' } },
 { id: 'priority-paths', type: 'element', tag: 'textarea', props: { id: '{priorities.inputId}', 'aria-label': 'Priority paths', rows: 5, value: '{priorities.draft}', disabled: '{priorities.disabled}', ...action('edit') },
  css: { ...control, display: 'block', width: '100%', 'font-family': 'monospace', 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' } },
 { id: 'priority-buttons', type: 'container', direction: 'row', gap: 8, css: { 'flex-wrap': 'wrap' }, children: [button('priority-save', 'Save upload priorities', 'save'), { ...button('priority-refresh', 'Reload saved priorities', 'reload'), props: { type: 'button', disabled: '{priorities.reloadDisabled}', ...action('reload') } }] },
 { id: 'priority-status', type: 'element', tag: 'p', text: '{priorities.message}', props: { role: 'status' }, css: { color: 'var(--tt-muted, #71717a)', 'font-size': '12px' } },
 { id: 'priority-error', type: 'element', tag: 'p', text: '{priorities.error}', props: { role: 'alert' } },
 { id: 'priority-list', type: 'collection', props: { itemsPath: 'priorities.rows', label: 'Saved upload priorities', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: 'No priority paths saved. Uploads use their normal order.' }, children: [
  { id: 'priority-row', type: 'container', direction: 'column', gap: 6, css: { 'min-width': '0', padding: '8px 0' }, children: [
   { id: 'priority-row-label', type: 'element', tag: 'p', text: '{item.position}. {item.path}', css: { 'overflow-wrap': 'anywhere', 'font-weight': '600' } },
   { id: 'priority-row-buttons', type: 'container', direction: 'row', gap: 8, css: { 'flex-wrap': 'wrap' }, children: [
    { ...button('priority-up', 'Move up', 'up', { path: '{item.path}' }), props: { type: 'button', 'aria-label': 'Move {item.path} up', disabled: '{item.upDisabled}', ...action('up', { path: '{item.path}' }) } },
    { ...button('priority-down', 'Move down', 'down', { path: '{item.path}' }), props: { type: 'button', 'aria-label': 'Move {item.path} down', disabled: '{item.downDisabled}', ...action('down', { path: '{item.path}' }) } },
    { ...button('priority-remove', 'Remove priority', 'remove', { path: '{item.path}' }), props: { type: 'button', 'aria-label': 'Remove priority {item.path}', disabled: '{priorities.disabled}', ...action('remove', { path: '{item.path}' }) } }
   ] }
  ] }
 ] },
 { id: 'priority-retention', type: 'element', tag: 'p', text: 'Priorities are saved on the syncing device for this account and connection. They change transfer order only. They do not remove local files or prove that a folder is fully backed up.', css: { 'font-size': '12px', color: 'var(--tt-muted, #71717a)' } }
]}];


export function useUploadPriorities(options: UploadPriorityOptions | undefined, currentScope: () => SyncScope) {
 const latest = React.useRef({ options, currentScope }); latest.current = { options, currentScope };
 const savedScope = React.useMemo(() => options && structuredClone(options.scope), [options && JSON.stringify(options.scope)]);
 const [saved, setSaved] = React.useState<Preferences | null>(options?.draftState?.saved ?? null), [draft, setDraft] = React.useState(options?.draftState?.draft ?? '');
 const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('Reading saved priorities…');
 const savedRef = React.useRef(saved); savedRef.current = saved;
 const draftRef = React.useRef(draft); draftRef.current = draft;
 const running = React.useRef<AbortSignal | null>(null), lifetime = React.useRef<AbortController | null>(null);
 const check = (signal = lifetime.current?.signal) => {
  if (!savedScope || !latest.current.options || !signal || signal.aborted || signal !== lifetime.current?.signal || !sameSyncScope(savedScope, latest.current.options.scope) || !sameSyncScope(savedScope, latest.current.currentScope())) throw Error('The account or sync connection changed.');
 };
 const work = async (paths?: string[]) => {
  const signal = lifetime.current?.signal;
  if (!savedScope || !signal || signal.aborted || running.current === signal) return;
  running.current = signal; setBusy(true); setError('');
  try {
   check(signal); const transport = latest.current.options?.transport;
   const journal = transport ? null : await openSyncJournal();
   try {
    check(signal); const priorities = journal?.priorities({ scope: savedScope, currentScope: () => latest.current.currentScope(), signal });
    const result = transport ? paths === undefined ? await transport.read(signal) : await transport.save(paths, savedRef.current!.revision, signal)
     : paths === undefined ? await priorities!.read() : await priorities!.save(paths, savedRef.current!.revision);
    check(signal); savedRef.current = result; setSaved(result); setDraft(result.paths.join('\n'));
    if (latest.current.options?.draftState) Object.assign(latest.current.options.draftState, { saved: result, draft: result.paths.join('\n') });
    setMessage(paths === undefined ? 'Saved priorities loaded.' : 'Upload priorities saved. They apply after the current operation finishes.');
   } finally { journal?.close(); }
  } catch (cause) {
   if (!signal?.aborted) setError((cause instanceof Error ? cause.message : 'Could not save upload priorities.') + ' Your draft is preserved.');
  } finally { if (running.current === signal) running.current = null; if (!signal.aborted) setBusy(false); }
 };
 React.useEffect(() => {
  const controller = new AbortController(); lifetime.current = controller;
  if (savedScope) {
   const retained = latest.current.options?.draftState;
   if (retained?.saved && retained.draft !== undefined && retained.draft !== retained.saved.paths.join('\n')) setMessage('Unsaved priority draft restored. Save it or reload the saved priorities.');
   else void work();
  }
  return () => controller.abort();
 }, [savedScope]);
 const save = async (paths: string[]) => {
  if (!savedRef.current) return;
  try { check(); await work(parseUploadPriorityDraft(paths.join('\n'), latest.current.options!)); }
  catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid priority paths.'); }
 };
 const moveFirst = async (path: string) => {
  if (!savedRef.current || running.current) return;
  if (draftRef.current !== savedRef.current.paths.join('\n')) { setError('Save your priority draft before choosing another file.'); return; }
  await save([path, ...savedRef.current.paths.filter(p => syncPathKey(p) !== syncPathKey(path))]);
 };
 const editOrder = async (operation: string, path: unknown) => {
  if (!savedRef.current || typeof path !== 'string' || running.current) return;
  if (draftRef.current !== savedRef.current.paths.join('\n')) { setError('Save your priority draft before reordering saved paths.'); return; }
  const paths = [...savedRef.current.paths], index = paths.indexOf(path); if (index < 0) return;
  if (operation === 'remove') paths.splice(index, 1);
  else { const target = index + (operation === 'up' ? -1 : 1); if (target < 0 || target >= paths.length) return; [paths[index], paths[target]] = [paths[target], paths[index]]; }
  await save(paths);
 };
 const inputId = React.useId();
 return { enabled: !!options, disabled: busy || !saved, moveFirst,
  scope: { priorities: { inputId, draft, disabled: busy || !saved, reloadDisabled: busy, error, message,
   rows: (saved?.paths ?? []).map((path, index, paths) => ({ id: path, path, position: index + 1, upDisabled: busy || index === 0, downDisabled: busy || index === paths.length - 1 })) } },
  actions: { edit: ({ value }: { value: unknown }) => { if (!busy) { const next = String(value ?? ''); setDraft(next); if (latest.current.options?.draftState) Object.assign(latest.current.options.draftState, { saved: savedRef.current ?? undefined, draft: next }); setError(''); } },
   save: () => save(draftRef.current.split(/\r?\n/).filter(Boolean)), reload: () => work(),
   up: ({ inputs }: { inputs: Readonly<Record<string, unknown>> }) => editOrder('up', inputs.path),
   down: ({ inputs }: { inputs: Readonly<Record<string, unknown>> }) => editOrder('down', inputs.path),
   remove: ({ inputs }: { inputs: Readonly<Record<string, unknown>> }) => editOrder('remove', inputs.path) }
 };
}
export function SyncUploadPriorities({ controller, scopeKey, accountTransport }: { controller: ReturnType<typeof useUploadPriorities>; scopeKey: string; accountTransport?: SettingsDocumentHostProps['accountTransport'] }) {
 if (!controller.enabled) return null;
 return <SettingsDocumentHost documentKey="file-sync-upload-priorities" defaultDocument={syncUploadPriorityBlocks} scopeKey={scopeKey} title="Upload priorities" accountTransport={accountTransport}>
  {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={controller.scope} actions={controller.actions} enabled={!editing}>
   <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
  </TransientBlockHost>}
 </SettingsDocumentHost>;
}
