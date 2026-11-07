import React from 'react';
import { listPasswordFiles, openPasswordFile, uploadPasswordFile, type SavedPasswordFile } from '~/passwords/files.client';
import { newPasswordFile } from '~/passwords/fileCrypto';
import { passwordRequest } from '~/passwords/client';
import type { TransientBlockActions } from '../Builder/TransientBlockHost';
import { PasswordPanelDocument } from './PasswordPanelDocument';
import { passwordAttachmentBlocks, passwordAttachmentItems } from './passwordPanelBlocks';

type Props = { ownerId: string; entryId: string; readOnly?: boolean; sourceItem?: string };
export function PasswordAttachments(props: Props) {
  return <PasswordAttachmentsScope key={`${props.ownerId}:${props.entryId}:${!!props.readOnly}`} {...props} />;
}
function PasswordAttachmentsScope({ ownerId, entryId, readOnly = false, sourceItem }: Props) {
  const [showAll, setShowAll] = React.useState(false);
  const [files, setFiles] = React.useState<SavedPasswordFile[]>([]);
  const [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
  const controller = React.useRef(new AbortController());
  const pending = React.useRef<{ file: File; metadata: ReturnType<typeof newPasswordFile> } | null>(null);
  const running = React.useRef(false);
  const scopeKey = `${typeof window === 'undefined' ? '' : window.location.origin}:${ownerId}:${entryId}`;
  const refresh = React.useCallback(async (signal: AbortSignal) => {
    const result = await listPasswordFiles(ownerId, entryId, signal);
    signal.throwIfAborted(); setFiles(result);
  }, [ownerId, entryId]);
  React.useEffect(() => {
    const active = new AbortController(); controller.current = active;
    void refresh(active.signal).catch(() => { if (!active.signal.aborted) setError('Files could not be loaded.'); });
    return () => { active.abort(); pending.current = null; };
  }, [refresh]);
  const run = async (signal: AbortSignal, work: (signal: AbortSignal) => Promise<void>) => {
    if (running.current || signal.aborted) return;
    const lifetime = controller.current.signal;
    const active = AbortSignal.any([lifetime, signal]);
    running.current = true; setBusy(true); setError('');
    try { await work(active); }
    catch (cause) { if (!active.aborted) setError(cause instanceof Error ? cause.message : 'File unavailable.'); }
    finally { running.current = false; if (!lifetime.aborted) setBusy(false); }
  };
  const upload = (signal: AbortSignal) => run(signal, async active => {
    if (readOnly || !pending.current) return;
    const current = pending.current;
    await uploadPasswordFile(ownerId, entryId, current.metadata, () => current.file.stream(), active);
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
      const file = displayed.find(item => item.id === inputs.id); if (!file) return;
      return run(signal, async active => {
        const opened = await openPasswordFile(ownerId, entryId, file.id, active);
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
      return run(signal, async active => { await passwordRequest(ownerId, { operation: 'file-delete', entryId, fileId: file.id }, active); active.throwIfAborted(); await refresh(active); });
    }
  };
  return <PasswordPanelDocument documentKey={readOnly ? 'password-source-files' : 'password-attachments'} title="Password attachment layout"
    scopeKey={scopeKey} blocks={passwordAttachmentBlocks} actions={actions} scope={{ files: {
      heading: readOnly ? 'Related source documents and icons' : 'Attachments', writable: !readOnly,
      busy, error, items: passwordAttachmentItems(displayed), canToggle: !!(readOnly && sourceItem),
      toggleLabel: showAll ? 'Show related files' : `Show all ${files.length} original archive files`, canRetry: !!pending.current && !!error
    } }} />;
}
