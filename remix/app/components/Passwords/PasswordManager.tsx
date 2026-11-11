import { PasswordBrandMark } from './PasswordBrandMark';
import { PasswordSource } from './PasswordSource';
import { PasswordGenerator } from './PasswordGenerator';
import { PasswordIconEditor } from './PasswordIcon';
import { PasswordPasskeySetup } from './PasswordPasskeySetup';
import { createPasswordBackup } from '~/passwords/backup.client';
import { PasswordAttachments } from './PasswordAttachments';
import { uploadPasswordFile } from '~/passwords/files.client';
import { newPasswordFile, type PasswordFile } from '~/passwords/fileCrypto';
import { PasswordPreviewList } from './PasswordPreviewList';
import { PasswordVerificationSettings } from './PasswordVerificationSettings';
import React from 'react';
import { Box, Button, Flex, Heading, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Text } from '@chakra-ui/react';
import { Link, useLocation } from 'react-router';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { passwordTransferBlocks } from './passwordEntryBlocks';
import { PasswordWorkspaceControls } from './PasswordWorkspaceControls';
import type { TransientBlockActions } from '../Builder/TransientBlockHost';
import { PasswordEntryEditor } from './PasswordEntryEditor';
import { emptyPasswordEntry, passwordPreviewUsername, type PasswordEntry, type PasswordMetadata } from '~/passwords/model';
import { passwordWebsiteOrigins } from '~/passwords/icons';
import { passwordRequest } from '~/passwords/client';
import { previewPasswordFile, visitPasswordFile, passwordImportErrorMessage, exportPasswordBackup, type PasswordFormat, type PasswordImportPreview } from '~/passwords/transfer';
import { scanQrFile, scanQrScreen } from '~/passwords/qr.client';
import { hasNativePasswordProvider } from '~/passwords/native.client';

type Draft = { id: string; revision: number; entry: PasswordEntry };
const changed = () => window.dispatchEvent(new Event('thingtime:passwords-changed'));
const card = { border: '1px solid var(--tt-border, #e6e6eb)', borderRadius: '12px', p: 4, background: 'var(--tt-card, #fff)' };
export function PasswordManager() {
  const user = useCurrentUser(), location = useLocation(), plane = useDataPlane();
  return <Box width="100%" pt="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))">{user && !user.temporary ? <PasswordManagerScope key={`${user.id}:${plane}:${location.key}`} ownerId={user.id} /> : <Box p={6}><Flex alignItems="center" gap={3}><PasswordBrandMark /><Heading size="md">Password manager</Heading></Flex><Text mt={3}>Sign in to unlock your password manager.</Text><Button as={Link} to="/login" mt={3}>Sign in</Button></Box>}</Box>;
}
function PasswordManagerScope({ ownerId }: { ownerId: string }) {
  const lopu = useLopu();
  const [records, setRecords] = React.useState<PasswordMetadata[]>([]), [cursor, setCursor] = React.useState<string | null>(null);
  const [configured, setConfigured] = React.useState<boolean | null>(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [iconBusy, setIconBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const editorHeading = React.useRef<HTMLDivElement>(null);
  const editorControls = React.useRef<HTMLDivElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const [openCount, setOpenCount] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!openCount) return;
    const heading = editorHeading.current?.querySelector<HTMLElement>('[data-block-id="pw-entry-heading"]');
    heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: 'start' });
  }, [openCount]);
  const [search, setSearch] = React.useState(''), [sort, setSort] = React.useState('title');
  const [listLoading, setListLoading] = React.useState(true), [settledSearch, setSettledSearch] = React.useState<string | null>(null);
  const listEpoch = React.useRef(0), listAbort = React.useRef<AbortController | null>(null);
  const [transfer, setTransfer] = React.useState<'import' | 'export' | null>(null), [imported, setImported] = React.useState<PasswordImportPreview | null>(null);
  const [format, setFormat] = React.useState<PasswordFormat>('1pux'), [acknowledged, setAcknowledged] = React.useState(false), [progress, setProgress] = React.useState('');
  const [readingImport, setReadingImport] = React.useState(false);
  const importRead = React.useRef<AbortController | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [nativeAvailable, setNativeAvailable] = React.useState(false);
  React.useEffect(() => { const check = () => setNativeAvailable(hasNativePasswordProvider()); check(); window.addEventListener('thingtime:native-bridge-ready', check); return () => window.removeEventListener('thingtime:native-bridge-ready', check); }, []);
  const generation = React.useRef(0), active = React.useRef(true), controllers = React.useRef(new Set<AbortController>());
  const retry = React.useRef<{ payload: string; writeId: string } | null>(null), importSource = React.useRef<{ file: File; count: number; saved: number; archive?: { id: string; writeId: string; saved: boolean }; filesSaved?: number; entryIds?: Map<number, string>; restoredIds?: Map<string, string>; iconFiles?: Map<number, string>; pendingIcon?: { id: string; revision: number; writeId: string; entry: PasswordEntry }; pendingFile?: PasswordFile; pending?: { id: string; writeId: string; entry: PasswordEntry } } | null>(null);
  const clear = React.useCallback(() => {
    listEpoch.current++; setListLoading(false); generation.current++; controllers.current.forEach(controller => controller.abort()); controllers.current.clear();
    returnFocus.current = null; setDraft(null); setIconBusy(false); setImported(null); importSource.current = null; importRead.current?.abort(); importRead.current = null; setReadingImport(false); retry.current = null; setTransfer(null); setBusy(false); setDeleteConfirm(false); setAcknowledged(false); setProgress('');
  }, []);
  React.useEffect(() => {
    active.current = true;
    // Tab switching and the screen picker must not silently discard unsaved
    // entries. Mask visible secrets, retain drafts only in component memory.
    const hidden = () => { if (document.visibilityState === 'hidden') window.dispatchEvent(new Event('thingtime:mask-vault-values')); };
    window.addEventListener('pagehide', clear); window.addEventListener('thingtime:hide-vault-values', clear); document.addEventListener('visibilitychange', hidden);
    return () => { active.current = false; generation.current++; controllers.current.forEach(c => c.abort()); controllers.current.clear(); window.removeEventListener('pagehide', clear); window.removeEventListener('thingtime:hide-vault-values', clear); document.removeEventListener('visibilitychange', hidden); };
  }, [clear]);
  const request = React.useCallback(async (body?: Record<string, unknown>, next?: string) => {
    const controller = new AbortController(), version = generation.current; controllers.current.add(controller);
    try { const result = await passwordRequest(ownerId, body, controller.signal, next); if (!active.current || version !== generation.current) throw new DOMException('Cancelled', 'AbortError'); return result; }
    finally { controllers.current.delete(controller); }
  }, [ownerId]);
  const refresh = React.useCallback(async (next?: string) => {
    listAbort.current?.abort();
    const controller = new AbortController(), epoch = ++listEpoch.current, version = generation.current;
    listAbort.current = controller; controllers.current.add(controller); setListLoading(true);
    const current = () => active.current && epoch === listEpoch.current && version === generation.current && !controller.signal.aborted;
    try {
      const result = await passwordRequest(ownerId, undefined, controller.signal, next, search.trim(), true);
      if (!current()) return;
      setRecords(prev => next ? [...prev.filter(item => !result.entries.some((entry: PasswordMetadata) => entry.id === item.id)), ...result.entries] : result.entries);
      setCursor(result.nextCursor); setConfigured(result.configured); setSettledSearch(search);
    } catch (reason) { if (current()) throw reason; }
    finally { controllers.current.delete(controller); if (current()) setListLoading(false); }
  }, [ownerId, search]);
  const showError = React.useCallback((reason: any) => { if (reason?.name === 'AbortError' || !active.current) return; if (reason?.status === 401 || (reason?.status === 409 && /account/.test(reason.message))) { clear(); setRecords([]); } setError(reason instanceof Error ? reason.message : 'Please try again.'); }, [clear]);
  React.useEffect(() => {
    const timer = setTimeout(() => refresh().catch(showError), 200);
    const check = () => { clearTimeout(timer); refresh().catch(showError); };
    window.addEventListener('focus', check);
    return () => { clearTimeout(timer); listAbort.current?.abort(); window.removeEventListener('focus', check); };
  }, [refresh, showError]);
  const clearAndRefresh = () => { clear(); refresh().catch(showError); };
  const closeEntry = () => {
    const trigger = returnFocus.current;
    clearAndRefresh();
    if (trigger?.isConnected) trigger.focus();
  };
  const changeSearch = (value: string) => {
    listEpoch.current++; listAbort.current?.abort(); setListLoading(true); setError(''); setSearch(value);
  };
  const run = async (work: () => Promise<void>) => { if (busy || iconBusy) return; const version = generation.current; setBusy(true); setError(''); try { await work(); } catch (reason) { if (version === generation.current) showError(reason); } finally { if (active.current && version === generation.current) setBusy(false); } };
  const updateEntry = (entry: PasswordEntry) => setDraft(prev => prev ? { ...prev, entry } : prev);
  const addTotp = (value: string) => setDraft(prev => prev ? { ...prev, entry: { ...prev.entry, fields: [...prev.entry.fields, { id: crypto.randomUUID(), label: 'Verification code', type: 'totp', value }] } } : prev);
  const save = () => {
    for (const field of editorControls.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select') || []) if (!field.disabled && !field.reportValidity()) return;
    return run(async () => {
    if (!draft) return;
    const payload = JSON.stringify(draft); if (retry.current?.payload !== payload) retry.current = { payload, writeId: crypto.randomUUID() };
    const result = await request({ operation: 'save', ...draft, writeId: retry.current.writeId });
    retry.current = null; setDraft(prev => prev?.id === draft.id ? { ...prev, revision: result.record.revision } : prev);
    const username = passwordPreviewUsername(draft.entry);
    const record = { ...result.record, ...(username ? { username } : {}), ...(!result.record.icon && passwordWebsiteOrigins(draft.entry).length ? { websiteIcon: true } : {}) };
    setRecords(prev => [...prev.filter(item => item.id !== record.id), record]); changed(); lopu({ title: 'Password entry saved', status: 'success' });
  }); };
  const read = (record: PasswordMetadata, trigger: HTMLElement | null) => run(async () => {
    const result = await request({ operation: 'read', id: record.id });
    returnFocus.current = trigger;
    setDraft({ id: result.id, revision: result.revision, entry: result.entry });
    retry.current = null;
    setDeleteConfirm(false);
    setOpenCount(value => value + 1);
  });
  const loadImport = async (file?: File) => {
    if (!file || busy) return;
    importRead.current?.abort();
    const controller = new AbortController(), version = generation.current;
    importRead.current = controller; controllers.current.add(controller);
    const current = () => active.current && version === generation.current && importRead.current === controller && !controller.signal.aborted;
    setError(''); setProgress('Reading export…'); setImported(null); importSource.current = null; setReadingImport(true);
    try {
      const result = await previewPasswordFile(file, controller.signal, count => { if (current() && count % 50 === 0) setProgress(`${count} entries checked…`); });
      if (!current()) return;
      setImported(result); importSource.current = { file, count: result.count, saved: 0 }; setProgress('');
    } catch (reason) {
      if (current()) { setError(passwordImportErrorMessage(reason)); setProgress(''); }
    } finally { controllers.current.delete(controller); if (current()) setReadingImport(false); }
  };
  const commitImport = () => run(async () => {
    const source = importSource.current;
    if (!source || readingImport) return;
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      if (source.file.name.toLowerCase().endsWith('.1pux')) {
        source.archive ??= { id: crypto.randomUUID(), writeId: crypto.randomUUID(), saved: false };
        if (!source.archive.saved) {
          await request({ operation: 'save', id: source.archive.id, writeId: source.archive.writeId, revision: 0, entry: { title: `1Password archive · ${source.file.name}`, passwordType: 'document', fields: [{ id: 'archive-format', label: 'Archive format', type: 'text', value: '1pux' }, { id: 'notes', label: 'Notes', type: 'notes', value: 'Original archive members, including account and vault metadata, documents, icons, and unknown properties. Each member is encrypted separately. Keep this entry to preserve the complete source export.' }] } });
          source.archive.saved = true;
        }
      }
      // Re-read the immutable File, retaining only the current save. On retry,
      // skip acknowledged entries and reuse the pending id/writeId exactly.
      await visitPasswordFile(source.file, { signal: controller.signal, onEntry: async (entry, index, sourceId) => {
        source.entryIds ??= new Map(); source.restoredIds ??= new Map();
        // Attachment IDs belong to the source vault. Bind an icon only after
        // its encrypted file has been restored to this new owner-local entry.
        if (entry.icon?.kind === 'attachment') {
          source.iconFiles ??= new Map(); source.iconFiles.set(index, entry.icon.fileId);
          const { icon: _sourceIcon, ...withoutIcon } = entry; entry = withoutIcon;
        }
        const mapped = (old: string) => { if (!source.restoredIds!.has(old)) source.restoredIds!.set(old, crypto.randomUUID()); return source.restoredIds!.get(old)!; };
        if (sourceId) source.entryIds.set(index, mapped(sourceId));
        if (index < source.saved) return;
        if (entry.importArchiveId && sourceId) entry = { ...entry, importArchiveId: mapped(entry.importArchiveId) };
        source.pending ??= { entry: { ...entry, ...(!sourceId && source.archive ? { importArchiveId: source.archive.id } : {}) }, id: source.entryIds.get(index) || crypto.randomUUID(), writeId: crypto.randomUUID() };
        source.entryIds.set(index, source.pending.id);
        await request({ operation: 'save', ...source.pending, revision: 0 });
        source.pending = undefined; source.saved++; setProgress(`${source.saved} of ${source.count} saved`);
      }, onFile: async (file, index) => {
        if (!source.archive || index < (source.filesSaved || 0)) return;
        source.pendingFile ??= { ...newPasswordFile(file.original?.name || file.name, file.size), ...(file.original || { archivePath: file.path, role: file.path.startsWith('files/') ? 'attachment' as const : 'source' as const }) };
        const entryId = file.entryIndex === undefined ? source.archive.id : source.entryIds!.get(file.entryIndex)!;
        const uploaded = await uploadPasswordFile(ownerId, entryId, source.pendingFile, file.open, controller.signal);
        if (file.entryIndex !== undefined && file.original?.id && source.iconFiles?.get(file.entryIndex) === file.original.id) {
          if (!source.pendingIcon) {
            const current = await request({ operation: 'read', id: entryId });
            source.pendingIcon = { id: entryId, revision: current.revision, writeId: crypto.randomUUID(), entry: { ...current.entry, icon: { kind: 'attachment', fileId: uploaded.id } } };
          }
          // Keep the complete identity and payload if the save outcome is
          // uncertain so retry cannot create a second revision or overwrite.
          await request({ operation: 'save', ...source.pendingIcon });
          source.pendingIcon = undefined;
        }
        source.pendingFile = undefined; source.filesSaved = index + 1;
        setProgress(`${source.saved} entries and ${source.filesSaved} archive files saved`);
      } });
      importSource.current = null; setImported(null); setTransfer(null); await refresh(); changed(); lopu({ title: 'Password import complete', status: 'success' });
    } finally { controllers.current.delete(controller); }
  });
  const download = () => run(async () => {
    if (format === '1pux') {
      const controller = new AbortController(); controllers.current.add(controller);
      try {
        const blob = await createPasswordBackup(ownerId, controller.signal, setProgress); controller.signal.throwIfAborted();
        const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'thingtime-passwords.1pux'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setTransfer(null); setAcknowledged(false); setProgress(''); return;
      } finally { controllers.current.delete(controller); }
    }
    const values: PasswordEntry[] = []; let next: string | undefined;
    do { const page = await request({ operation: 'export', ...(next ? { cursor: next } : {}) }); values.push(...page.entries.map((record: { entry: PasswordEntry }) => record.entry)); next = page.nextCursor || undefined; setProgress(`${values.length} entries prepared`); } while (next);
    const result = exportPasswordBackup(values, format), blob = new Blob([result.bytes as BlobPart], { type: result.mime }), url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `thingtime-passwords.${result.extension}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setTransfer(null); setAcknowledged(false); setProgress('');
  });
  const visible = records.filter(record => record.title.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title));
  const workspaceScope = { busy: busy || iconBusy, cannotAdd: busy || iconBusy || configured === false, search, sort,
    loading: listLoading, loadingLabel: search.trim() ? 'Searching all password titles' : 'Refreshing passwords',
    empty: !listLoading && settledSearch === search && !visible.length, emptyLabel: search.trim() ? 'No matching password titles.' : 'Add a login, API key, secure note or authenticator.',
    hasMore: Boolean(cursor && settledSearch === search), cannotLoadMore: listLoading || busy || iconBusy, canRetry: Boolean(error && !listLoading),
    entryTitle: draft?.revision ? 'Edit entry' : 'New entry', saved: Boolean(draft?.revision), deleteConfirm };
  const workspaceActions: TransientBlockActions = {
    'password.add': () => { if (busy || iconBusy || configured === false) return; clearAndRefresh(); setDraft({ id: crypto.randomUUID(), revision: 0, entry: emptyPasswordEntry() }); setOpenCount(value => value + 1); },
    'password.import': () => { if (!busy && !iconBusy) { clearAndRefresh(); setTransfer('import'); } },
    'password.export': () => { if (!busy && !iconBusy) { clearAndRefresh(); setTransfer('export'); } },
    'password.close': closeEntry,
    'password.search': ({ value }) => changeSearch(String(value ?? '')),
    'password.sort': ({ value }) => { if (value === 'title' || value === 'updated') setSort(value); },
    'password.more': () => { if (cursor && settledSearch === search && !listLoading) return run(() => refresh(cursor)); },
    'password.retry': () => { setError(''); return refresh().catch(showError); },
    'transfer.file': ({ readFile }) => loadImport(readFile('import-file')),
    'transfer.format': ({ value }) => { if (['1pux', '1password', 'chrome', 'apple'].includes(String(value))) setFormat(value as PasswordFormat); },
    'transfer.acknowledge': ({ value }) => setAcknowledged(value === true),
    'transfer.confirm': () => { if (busy || iconBusy || (transfer === 'import' ? readingImport || !imported || (!imported.count && !imported.fileCount) : !acknowledged)) return; return transfer === 'import' ? commitImport() : download(); },
    'entry.save': save,
    'entry.delete': () => { if (!busy && !iconBusy && draft?.revision) setDeleteConfirm(true); },
    'entry.keep': () => setDeleteConfirm(false),
    'entry.confirm-delete': () => run(async () => { if (!draft || !deleteConfirm) return; await request({ operation: 'delete', id: draft.id, revision: draft.revision }); setRecords(prev => prev.filter(record => record.id !== draft.id)); changed(); clearAndRefresh(); }),
    'qr.screen': () => run(async () => { const version = generation.current, controller = new AbortController(); controllers.current.add(controller); try { const result = await scanQrScreen(controller.signal); if (version === generation.current) addTotp(result); } finally { controllers.current.delete(controller); } }),
    'qr.file': ({ readFile }) => { const file = readFile('qr-file'); if (file) return run(async () => { const version = generation.current, result = await scanQrFile(file); if (version === generation.current) addTotp(result); }); },
  };
  const controls = (kind: React.ComponentProps<typeof PasswordWorkspaceControls>['kind']) => <PasswordWorkspaceControls kind={kind} scopeKey={ownerId} scope={workspaceScope} actions={workspaceActions} />;
  return <Box width="100%" maxWidth="1100px" mx="auto" px={{ base: 3, md: 6 }} py={6}>
    {controls('toolbar')}
    {configured === false && <Text mt={4}>Password encryption needs deployment configuration before you can save entries.</Text>}
    <Box mt={4}><PasswordVerificationSettings ownerId={ownerId} /></Box>
    <PasswordPasskeySetup ownerId={ownerId} nativeAvailable={nativeAvailable} />
    {error && <Text role="alert" color="red.600" mt={4}>{error}</Text>}
    <Flex gap={5} mt={6} alignItems="start" direction={{ base: 'column', md: 'row' }}>
      <Box width={{ base: '100%', md: draft ? '34%' : '100%' }} minWidth={0}>
        {controls('filters')}
        <PasswordPreviewList ownerId={ownerId} entries={visible} disabled={busy || iconBusy} onOpen={read} />
        {controls('status')}
      </Box>
      {draft && <Box ref={editorControls} {...card} flex={1} width={{ base: '100%', md: 'auto' }} minWidth={0}>
        <PasswordWorkspaceControls kind="entry-heading" scopeKey={ownerId} scope={workspaceScope} actions={workspaceActions} headingRef={editorHeading} />
        <PasswordEntryEditor key={`password-fields:${draft.id}`} entry={draft.entry} scopeKey={`${ownerId}:${draft.id}`} disabled={busy || iconBusy} onChange={updateEntry} />
        {draft.entry.passwordType !== 'passkey' && <PasswordGenerator key={`password-generator:${draft.id}`} ownerId={ownerId} origin={window.location.origin} targets={draft.entry.fields.filter(field => field.type === 'password').map(({ id, label }) => ({ id, label }))} disabled={busy || iconBusy} onGenerate={(value, fieldId) => setDraft(current => current?.id === draft.id && current.entry.passwordType !== 'passkey' ? { ...current, entry: { ...current.entry, fields: current.entry.fields.map(field => field.id === fieldId && field.type === 'password' ? { ...field, value } : field) } } : current)} />}
        <PasswordVerificationSettings key={draft.id} ownerId={ownerId} entryWindow={draft.entry.verificationWindow ?? 'global'} onEntryChange={value=>updateEntry({...draft.entry,verificationWindow:value})} />
        <PasswordIconEditor ownerId={ownerId} entryId={draft.id} saved={draft.revision > 0} icon={draft.entry.icon} website={draft.entry.fields.find(field => field.type === 'url')?.value} disabled={busy} onBusyChange={setIconBusy} onChange={icon => setDraft(current => current?.id === draft.id ? { ...current, entry: { ...current.entry, icon } } : current)} />
        {draft.entry.onePassword && <PasswordSource ownerId={ownerId} entryId={draft.id} entry={draft.entry} />}
        {draft.revision > 0 ? <PasswordAttachments key={`password-files:${draft.id}`} ownerId={ownerId} entryId={draft.id} /> : <Text mt={5} fontSize="sm">Save this entry to add attachments.</Text>}
        {draft.entry.importArchiveId && <PasswordAttachments key={`password-source-files:${draft.entry.importArchiveId}`} ownerId={ownerId} entryId={draft.entry.importArchiveId} sourceItem={draft.entry.onePassword} readOnly />}
        {controls('authenticator')}
        {controls('entry-actions')}
      </Box>}
    </Flex>
    <Modal isOpen={transfer !== null} onClose={clearAndRefresh} size="xl"><ModalOverlay /><ModalContent mx={3}><ModalHeader><Flex alignItems="center" gap={3}><PasswordBrandMark /><span>{transfer === 'import' ? 'Import passwords' : 'Export passwords'}</span></Flex></ModalHeader><ModalCloseButton /><ModalBody>
      <SettingsDocumentHost documentKey="password-transfer" title="Password transfer layout" defaultDocument={passwordTransferBlocks} scopeKey={ownerId} layoutEditingDisabled={busy}>
        {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${ownerId}:${transfer}`} enabled={!editing} actions={workspaceActions} scope={{ passwords: {
          busy, importing: transfer === 'import', exporting: transfer === 'export', importReady: Boolean(imported),
          importSummary: imported ? `${imported.count} entries and ${imported.fileCount} archive files ready` : '',
          importEntries: (imported?.entries || []).map(entry => ({ title: entry.title, type: entry.passwordType.replace(/-/g, ' ') })),
          importMore: imported && imported.count > imported.entries.length ? `and ${imported.count - imported.entries.length} more` : '',
          importWarnings: (imported?.warnings || []).map(message => ({ message })), format, acknowledged, progress, error,
          transferAction: transfer === 'import' ? 'Import entries' : 'Download export',
          cannotTransfer: busy || (transfer === 'import' ? readingImport || !imported || (!imported.count && !imported.fileCount) : !acknowledged)
        } }}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare /></TransientBlockHost>}
      </SettingsDocumentHost>
    </ModalBody></ModalContent></Modal>
  </Box>;
}
