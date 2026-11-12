import React from 'react';
import type { PasswordStorage, SavedPasswordFile } from '~/passwords/storage';
import { LOCAL_WORKSPACE_CHANGED } from '~/local-workspace/runtime.client';
import { newPasswordFile } from '~/passwords/fileCrypto';
import type { TransientBlockActions } from '../Builder/TransientBlockHost';
import { PasswordPanelDocument } from './PasswordPanelDocument';
import { passwordAttachmentBlocks, passwordAttachmentItems } from './passwordPanelBlocks';

type Props = { storage: PasswordStorage; ownerId: string; entryId: string; readOnly?: boolean; sourceItem?: string };
export function PasswordAttachments(props: Props) {
  return <PasswordAttachmentsScope key={`${props.ownerId}:${props.entryId}:${!!props.readOnly}`} {...props} />;
}
function PasswordAttachmentsScope({ storage, ownerId, entryId, readOnly = false, sourceItem }: Props) {
  const [listed, setListed] = React.useState(true);
  const sequence = React.useRef(0);
  const [showAll, setShowAll] = React.useState(false);
  const [files, setFiles] = React.useState<SavedPasswordFile[]>([]);
  const [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
  const controller = React.useRef(new AbortController());
  const pending = React.useRef<{ file: File; metadata: ReturnType<typeof newPasswordFile> } | null>(null);
  const running = React.useRef(false);
  const scopeKey = `${typeof window === 'undefined' ? '' : window.location.origin}:${ownerId}:${entryId}`;
  const refresh = React.useCallback(async (signal: AbortSignal) => {
    const version = ++sequence.current;
    const [result, status] = await Promise.all([storage.listFiles([entryId], signal), storage.filesStatus?.(entryId, signal)]);
    signal.throwIfAborted();
    if (version === sequence.current) { setFiles(result); setListed(status?.listed !== false); }
  }, [storage, entryId]);
  React.useEffect(() => {
    const active = new AbortController(); controller.current = active;
    const update = () => { void refresh(active.signal).catch(() => { if (!active.signal.aborted) setError('Files could not be loaded. Saved files have been kept.'); }); };
    update();
    if (storage.filesStatus) window.addEventListener(LOCAL_WORKSPACE_CHANGED, update);
    return () => { active.abort(); pending.current = null; window.removeEventListener(LOCAL_WORKSPACE_CHANGED, update); };
  }, [refresh, storage]);
  const run = async (signal: AbortSignal, work: (signal: AbortSignal) => Promise<void>) => {
    if (running.current || signal.aborted) return;
    const lifetime = controller.current.signal;
    const active = AbortSignal.any([lifetime, signal]);
    running.current = true; setBusy(true); setError('');
    try { await work(active); }
    catch (cause) { if (!active.aborted) setError('File unavailable. Please retry.'); }
    finally { running.current = false; if (!lifetime.aborted) setBusy(false); }
  };
  const upload = (signal: AbortSignal) => run(signal, async active => {
    if (readOnly || !pending.current) return;
    const current = pending.current;
    await storage.uploadFile(entryId, current.metadata, () => current.file.stream(), active);
    active.throwIfAborted();
    if (pending.current === current) pending.current = null;
    await refresh(active);
  });
  const displayed = !readOnly || !sourceItem || showAll ? files : files.filter(file => {
    const id = file.metadata.archivePath?.split('/').at(-1)?.split('___')[0];
    return id && sourceItem.includes(id);
  });
  const actions: TransientBlockActions = {
    'files.choose': ({ readFile, signal }) => {
      signal.throwIfAborted(); if (readOnly || running.current) return;
      const file = readFile('attachment');
      if (file) { pending.current = { file, metadata: newPasswordFile(file.name, file.size) }; return upload(signal); }
    },
    'files.retry': ({ signal }) => { signal.throwIfAborted(); return upload(signal); },
    'files.toggle': ({ signal }) => { signal.throwIfAborted(); if (!running.current) setShowAll(value => !value); },
    'files.download': ({ inputs, signal }) => {
      signal.throwIfAborted();
      const file = displayed.find(item => item.id === inputs.id); if (!file || file.available === false) return;
      return run(signal, async active => {
        const opened = await storage.openFile(entryId, file.id, active);
        const blob = await new Response(opened.stream).blob(); active.throwIfAborted();
        const url = URL.createObjectURL(blob), anchor = document.createElement('a');
        anchor.href = url; anchor.download = opened.metadata.name; anchor.click();
        const revoke = () => URL.revokeObjectURL(url);
        active.addEventListener('abort', revoke, { once: true });
        setTimeout(() => { revoke(); active.removeEventListener('abort', revoke); }, 1000);
      });
    },
    'files.remove': ({ inputs, signal }) => {
      signal.throwIfAborted();
      const file = files.find(item => item.id === inputs.id); if (readOnly || !file) return;
      return run(signal, async active => { await storage.removeFile(entryId, file.id, active); active.throwIfAborted(); await refresh(active); });
    }
  };
  return <PasswordPanelDocument documentKey={readOnly ? 'password-source-files' : 'password-attachments'} title="Password attachment layout"
    scopeKey={scopeKey} blocks={passwordAttachmentBlocks} actions={actions} scope={{ files: {
      heading: readOnly ? 'Related source documents and icons' : 'Attachments', writable: !readOnly,
      busy, error, unlisted: !listed, items: passwordAttachmentItems(displayed, busy), canToggle: !!(readOnly && sourceItem),
      toggleLabel: showAll ? 'Show related files' : `Show all ${files.length} original archive files`, canRetry: !!pending.current && !!error
    } }} />;
}
