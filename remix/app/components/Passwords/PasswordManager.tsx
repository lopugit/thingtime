import { PasswordSource } from './PasswordSource';
import { PasswordGenerator } from './PasswordGenerator';
import { PasswordEntryIcon, PasswordIconEditor, usePasswordIconImages } from './PasswordIcon';
import { PasswordPasskeySetup } from './PasswordPasskeySetup';
import { createPasswordBackup } from '~/passwords/backup.client';
import { PasswordAttachments } from './PasswordAttachments';
import { accountPasswordStorage } from '~/passwords/files.client';
import { newPasswordFile, type PasswordFile } from '~/passwords/fileCrypto';
import React from 'react';
import { Box } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { useDataPlane } from '~/hooks/useDataPlane';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { TransientPrivateControls } from '../Builder/TransientPrivateControls';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { passwordAuthenticatorSetupBlocks, passwordManagerBlocks, passwordSignInBlocks, upgradePasswordManagerBlocks } from './passwordManagerBlocks';
import { passwordPropertyShape, passwordPropertyValues, patchPasswordProperty } from '~/passwords/structuredFields';
import { passwordEntryDisplay } from './passwordEntryDisplay';
import { totpCode } from '~/passwords/totp';
import { activityInterval, clearActivityInterval } from '~/activity/activityManager';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { emptyPasswordEntry, FIELD_TYPES, PASSWORD_TYPES, type PasswordEntry, type PasswordMetadata, type FieldType } from '~/passwords/model';
import { passwordRequest } from '~/passwords/client';
import { previewPasswordFile, visitPasswordFile, passwordImportErrorMessage, exportPasswordBackup, type PasswordFormat, type PasswordImportPreview } from '~/passwords/transfer';
import { scanQrFile, scanQrScreen } from '~/passwords/qr.client';
import { hasNativePasswordProvider, nativePasswordProvider } from '~/passwords/native.client';
import { AuthenticatorSetupSession, supportsAuthenticatorSetup, type SetupNotice } from '~/passwords/authenticatorSetup.client';

const StablePasswordGenerator = React.memo(PasswordGenerator);
const StablePasswordIconEditor = React.memo(PasswordIconEditor);
const StablePasswordPasskeySetup = React.memo(PasswordPasskeySetup);

type Draft = { id: string; revision: number; entry: PasswordEntry };
const changed = () => window.dispatchEvent(new Event('thingtime:passwords-changed'));
export function PasswordManager() {
  const user = useCurrentUser(), location = useLocation(), plane = useDataPlane();
  const scopeKey = `${user?.id || 'guest'}:${plane || ''}:${typeof window === 'undefined' ? '' : window.location.origin}:${location.key}`;
  return <Box width="100%" pt="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))">{user && !user.temporary ? <PasswordManagerScope key={scopeKey} ownerId={user.id} scopeKey={scopeKey} dataPlane={plane} accountLabel={user.username || user.displayName || user.email || "Signed-in account"} /> : <SettingsDocumentHost documentKey="password-sign-in" defaultDocument={passwordSignInBlocks} scopeKey={scopeKey} title="Password sign-in layout">{({ blocks, chrome, editing }) => <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />}</SettingsDocumentHost>}</Box>;
}
function PasswordManagerScope({ ownerId, scopeKey, dataPlane, accountLabel }: { ownerId: string; scopeKey: string; dataPlane: string | null; accountLabel: string }) {
  const lopu = useLopu();
  const storage = React.useMemo(() => {
    if (!localVault) return accountPasswordStorage(ownerId);
    const device = localVault.fileStorage();
    return { ...device,
      uploadFile: async (...args: Parameters<typeof device.uploadFile>) => { const file = await device.uploadFile(...args); announceLocalWorkspaceChange(); return file; },
      removeFile: async (...args: Parameters<typeof device.removeFile>) => { await device.removeFile(...args); announceLocalWorkspaceChange(); }
    };
  }, [ownerId, localVault]);
  const [records, setRecords] = React.useState<PasswordMetadata[]>([]), [cursor, setCursor] = React.useState<string | null>(null);
  const [configured, setConfigured] = React.useState<boolean | null>(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [iconBusy, setIconBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null), [customLabel, setCustomLabel] = React.useState(''), [customType, setCustomType] = React.useState<FieldType>('text');
  const [search, setSearch] = React.useState(''), [sort, setSort] = React.useState('title');
  const [listLoading, setListLoading] = React.useState(true), [settledSearch, setSettledSearch] = React.useState<string | null>(null);
  const listEpoch = React.useRef(0), listAbort = React.useRef<AbortController | null>(null);
  const [transfer, setTransfer] = React.useState<'import' | 'export' | null>(null), [imported, setImported] = React.useState<PasswordImportPreview | null>(null);
  const [format, setFormat] = React.useState<PasswordFormat>('1pux'), [acknowledged, setAcknowledged] = React.useState(false), [progress, setProgress] = React.useState('');
  const [readingImport, setReadingImport] = React.useState(false);
  const importRead = React.useRef<AbortController | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const [rawFields, setRawFields] = React.useState<Record<string, boolean>>({});
  const propertyIdentities = React.useRef(new Map<string, { shape: string; epoch: number }>());
  const propertyEpoch = React.useRef(0);
  const propertyDraft = React.useRef<string | undefined>(undefined);
  React.useEffect(() => setRawFields({}), [draft?.id]);
  const [copyFeedback, setCopyFeedback] = React.useState<Record<string, string>>({});
  const copyEpoch = React.useRef(0), copyCleanup = React.useRef<(() => void) | null>(null);
  const currentDraft = React.useRef(draft); currentDraft.current = draft;
  const [setupNotice, setSetupNotice] = React.useState<SetupNotice | null>(null);
  const [setupMessage, setSetupMessage] = React.useState('');
  const [setupShown, setSetupShown] = React.useState(false);
  const setupSession = React.useRef<AuthenticatorSetupSession | null>(null);
  React.useEffect(() => {
    let current = true;
    const bridge = window.thingtimeAuthenticatorSetup;
    if (!supportsAuthenticatorSetup(bridge) || window.location.pathname !== '/passwords') return;
    if (dataPlane !== 'home') { setSetupShown(true); setSetupMessage('Switch to the home data plane to receive native setup codes.'); return; }
    const session = new AuthenticatorSetupSession({ ownerId, dataPlane, bridge, events: window,
      current: () => current && window.location.pathname === '/passwords',
      onNotice: notice => { if (notice) setSetupShown(true); setSetupNotice(notice); },
      onStatus: message => { setSetupShown(true); setSetupMessage(message); },
      onError: () => { if (current) { setSetupShown(true); setSetupMessage('Could not receive the setup code. Check the destination and signed-in account, then retry or reopen the code.'); } }
    });
    setupSession.current = session;
    return () => { session.dispose(); current = false; setupSession.current = null; };
  }, [ownerId, scopeKey, dataPlane]);
  const resetCopy = React.useCallback(() => { copyEpoch.current++; copyCleanup.current?.(); copyCleanup.current = null; setCopyFeedback({}); }, []);
  React.useEffect(() => { resetCopy(); }, [draft, resetCopy]);
  const [codes, setCodes] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    const mask = () => { setRevealed({}); resetCopy(); };
    window.addEventListener('blur', mask); window.addEventListener('thingtime:mask-vault-values', mask);
    return () => { window.removeEventListener('blur', mask); window.removeEventListener('thingtime:mask-vault-values', mask); };
  }, []);
  React.useEffect(() => {
    let current = true;
    const fields = (draft?.entry.fields || []).filter(field => field.type === 'totp');
    setCodes({});
    if (!fields.length) return;
    const update = async () => {
      const values = await Promise.all(fields.map(async field => {
        try { const result = await totpCode(field.value); return [field.id, `${result.code} · ${result.remaining}s`] as const; }
        catch { return [field.id, 'Enter a valid TOTP secret or setup link'] as const; }
      }));
      if (current) setCodes(Object.fromEntries(values));
    };
    void update();
    const timer = activityInterval('timer:password-manager:totp', 'Password verification codes', update, 1000);
    return () => { current = false; clearActivityInterval(timer); };
  }, [draft?.entry.fields]);
  const [nativeAvailable, setNativeAvailable] = React.useState(false), [nativeMessage, setNativeMessage] = React.useState('');
  React.useEffect(() => { const check = () => setNativeAvailable((!localVault || (localVault.scope.kind === 'account' && canSyncAccountWorkspace(localVault.scope))) && hasNativePasswordProvider()); check(); const off = subscribeWorkspaceBinding(check); window.addEventListener('thingtime:native-bridge-ready', check); return () => { off(); window.removeEventListener('thingtime:native-bridge-ready', check); }; }, [localVault]);
  const generation = React.useRef(0), active = React.useRef(true), controllers = React.useRef(new Set<AbortController>());
  const invocationSignal = React.useRef<AbortSignal | null>(null), runSignal = React.useRef<AbortSignal | null>(null);
  const operationSignal = (own: AbortSignal) => AbortSignal.any([own, ...(runSignal.current ? [runSignal.current] : []), ...(invocationSignal.current ? [invocationSignal.current] : [])]);
  const retry = React.useRef<{ payload: string; writeId: string } | null>(null), importSource = React.useRef<{ file: File; count: number; saved: number; archive?: { id: string; writeId: string; saved: boolean }; filesSaved?: number; entryIds?: Map<number, string>; restoredIds?: Map<string, string>; iconFiles?: Map<number, string>; pendingIcon?: { id: string; revision: number; writeId: string; entry: PasswordEntry }; pendingFile?: PasswordFile; pending?: { id: string; writeId: string; entry: PasswordEntry } } | null>(null);
  const clear = React.useCallback(() => {
    listEpoch.current++; setListLoading(false); generation.current++; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); runSignal.current = null;
    resetCopy(); setRevealed({}); setCodes({}); setDraft(null); setIconBusy(false); setImported(null); importSource.current = null; importRead.current?.abort(); importRead.current = null; setReadingImport(false); retry.current = null; setTransfer(null); setBusy(false); setDeleteConfirm(false); setCustomLabel(''); setAcknowledged(false); setProgress('');
  }, []);
  const retire = React.useCallback(() => { copyEpoch.current++; copyCleanup.current?.(); active.current = false; generation.current++; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); }, []);
  React.useEffect(() => {
    active.current = true;
    // Tab switching and the screen picker must not silently discard unsaved
    // entries. Mask visible secrets, retain drafts only in component memory.
    const hidden = () => { if (document.visibilityState === 'hidden') window.dispatchEvent(new Event('thingtime:mask-vault-values')); };
    window.addEventListener('pagehide', clear); window.addEventListener('thingtime:hide-vault-values', clear); document.addEventListener('visibilitychange', hidden);
    return () => { retire(); window.removeEventListener('pagehide', clear); window.removeEventListener('thingtime:hide-vault-values', clear); document.removeEventListener('visibilitychange', hidden); };
  }, [clear, retire]);
  const request = React.useCallback(async (body?: Record<string, unknown>, next?: string) => {
    const controller = new AbortController(), version = generation.current; controllers.current.add(controller);
    try { const signal = operationSignal(controller.signal); signal.throwIfAborted(); const result = await passwordRequest(ownerId, body, signal, next); signal.throwIfAborted(); if (!active.current || version !== generation.current) throw new DOMException('Cancelled', 'AbortError'); return result; }
    finally { controllers.current.delete(controller); }
  }, [ownerId]);
  const refresh = React.useCallback(async (next?: string, parentSignal?: AbortSignal) => {
    listAbort.current?.abort();
    const controller = new AbortController(), epoch = ++listEpoch.current, version = generation.current;
    const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
    listAbort.current = controller; controllers.current.add(controller); setListLoading(true);
    const current = () => active.current && epoch === listEpoch.current && version === generation.current && !signal.aborted;
    try {
      const result = await passwordRequest(ownerId, undefined, signal, next, search.trim());
      if (!current()) return;
      setRecords(prev => next ? [...prev.filter(item => !result.entries.some((entry: PasswordMetadata) => entry.id === item.id)), ...result.entries] : result.entries);
      setCursor(result.nextCursor); setConfigured(result.configured); setSettledSearch(search);
    } catch (reason) { if (current()) throw reason; }
    finally { controllers.current.delete(controller); if (active.current && epoch === listEpoch.current && version === generation.current) setListLoading(false); }
  }, [ownerId, search]);
  const showError = React.useCallback((reason: any) => { if (reason?.name === 'AbortError' || !active.current) return; if (reason?.status === 401 || (reason?.status === 409 && /account/.test(reason.message))) { setupSession.current?.cancel(); clear(); setRecords([]); } setError(reason instanceof Error ? reason.message : 'Please try again.'); }, [clear]);
  React.useEffect(() => {
    const timer = setTimeout(() => refresh().catch(showError), 200);
    const check = () => { clearTimeout(timer); refresh().catch(showError); };
    window.addEventListener('focus', check);
    if (localVault) window.addEventListener(LOCAL_WORKSPACE_CHANGED, check);
    return () => { clearTimeout(timer); listAbort.current?.abort(); window.removeEventListener('focus', check); window.removeEventListener(LOCAL_WORKSPACE_CHANGED, check); };
  }, [refresh, showError, localVault]);
  const clearAndRefresh = () => { clear(); refresh().catch(showError); };
  const changeSearch = (value: string) => {
    listEpoch.current++; listAbort.current?.abort(); setListLoading(true); setError(''); setSearch(value);
  };
  const run = async (work: () => Promise<void>) => {
    if (busy || iconBusy || (runSignal.current && !runSignal.current.aborted) || invocationSignal.current?.aborted) return;
    const version = generation.current, controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, ...(invocationSignal.current ? [invocationSignal.current] : [])]);
    controllers.current.add(controller); runSignal.current = signal; setBusy(true); setError('');
    const release = () => { if (runSignal.current === signal) { runSignal.current = null; if (active.current && version === generation.current) setBusy(false); } };
    signal.addEventListener('abort', release, { once: true });
    try { signal.throwIfAborted(); await work(); signal.throwIfAborted(); }
    catch (reason) { if (!signal.aborted && version === generation.current) showError(reason); }
    finally { signal.removeEventListener('abort', release); controllers.current.delete(controller); release(); }
  };
  const updateEntry = (entry: PasswordEntry) => { resetCopy(); setDraft(prev => prev ? { ...prev, entry } : prev); };
  const addTotp = (value: string) => setDraft(prev => prev ? { ...prev, entry: { ...prev.entry, fields: [...prev.entry.fields, { id: crypto.randomUUID(), label: 'Verification code', type: 'totp', value }] } } : prev);
  const save = () => run(async () => {
    if (!draft) return;
    const payload = JSON.stringify(draft); if (retry.current?.payload !== payload) retry.current = { payload, writeId: crypto.randomUUID() };
    const result = await request({ operation: 'save', ...draft, writeId: retry.current.writeId });
    retry.current = null; setDraft(prev => prev?.id === draft.id ? { ...prev, revision: result.record.revision } : prev);
    setRecords(prev => [...prev.filter(item => item.id !== result.record.id), result.record]); changed(); lopu({ title: 'Password entry saved', status: 'success' });
  });
  const read = (record: PasswordMetadata) => run(async () => { resetCopy(); const result = await request({ operation: 'read', id: record.id }); setRevealed({}); setDraft({ id: result.id, revision: result.revision, entry: result.entry }); retry.current = null; setDeleteConfirm(false); });
  const loadImport = async (file?: File) => {
    if (!file || busy) return;
    importRead.current?.abort();
    const controller = new AbortController(), version = generation.current, signal = operationSignal(controller.signal);
    importRead.current = controller; controllers.current.add(controller);
    const current = () => active.current && version === generation.current && importRead.current === controller && !signal.aborted;
    setError(''); setProgress('Reading export…'); setImported(null); importSource.current = null; setReadingImport(true);
    try {
      const result = await previewPasswordFile(file, signal, count => { if (current() && count % 50 === 0) setProgress(`${count} entries checked…`); });
      if (!current()) return;
      setImported(result); importSource.current = { file, count: result.count, saved: 0 }; setProgress('');
    } catch (reason) {
      if (current()) { setError(passwordImportErrorMessage(reason)); setProgress(''); }
    } finally { controllers.current.delete(controller); if (active.current && version === generation.current && importRead.current === controller) setReadingImport(false); }
  };
  const commitImport = () => run(async () => {
    const source = importSource.current;
    if (!source || readingImport) return;
    const controller = new AbortController(), signal = operationSignal(controller.signal); controllers.current.add(controller);
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
      await visitPasswordFile(source.file, { signal, onEntry: async (entry, index, sourceId) => {
        signal.throwIfAborted();
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
        signal.throwIfAborted();
        if (!source.archive || index < (source.filesSaved || 0)) return;
        source.pendingFile ??= { ...newPasswordFile(file.original?.name || file.name, file.size), ...(file.original || { archivePath: file.path, role: file.path.startsWith('files/') ? 'attachment' as const : 'source' as const }) };
        const entryId = file.entryIndex === undefined ? source.archive.id : source.entryIds!.get(file.entryIndex)!;
        signal.throwIfAborted();
        const uploaded = await uploadPasswordFile(ownerId, entryId, source.pendingFile, file.open, signal);
        signal.throwIfAborted();
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
      signal.throwIfAborted(); importSource.current = null; setImported(null); setTransfer(null); await refresh(undefined, signal); signal.throwIfAborted(); changed(); lopu({ title: 'Password import complete', status: 'success' });
    } finally { controllers.current.delete(controller); }
  });
  const download = () => run(async () => {
    if (format === '1pux') {
      const controller = new AbortController(), signal = operationSignal(controller.signal); controllers.current.add(controller);
      try {
        const blob = await createPasswordBackup(ownerId, signal, value => { if (!signal.aborted) setProgress(value); }); signal.throwIfAborted();
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
  if (propertyDraft.current !== draft?.id) { propertyIdentities.current.clear(); propertyDraft.current = draft?.id; }
  for (const id of propertyIdentities.current.keys()) if (!draft?.entry.fields.some(field => field.id === id)) propertyIdentities.current.delete(id);
  for (const field of draft?.entry.fields || []) {
    const shape = passwordPropertyShape(field), previous = propertyIdentities.current.get(field.id);
    if (!previous || previous.shape !== shape) propertyIdentities.current.set(field.id, { shape, epoch: ++propertyEpoch.current });
  }
  const entryDisplay = passwordEntryDisplay(draft?.entry, revealed, copyFeedback, rawFields);
  const privateProperties = new Map<string, string | boolean>();
  for (const field of entryDisplay.fields) for (const property of field.properties) Object.assign(property, { epoch: propertyIdentities.current.get(field.id)?.epoch });
  for (const field of entryDisplay.fields) if (field.structured) {
    const values = passwordPropertyValues(draft!.entry.fields.find(source => source.id === field.id)!);
    for (const property of field.properties) {
      const source = values.get(property.path)!;
      privateProperties.set(property.name, typeof source.value === 'boolean' && !property.boolean ? String(source.value) : source.value);
      privateProperties.set(property.labelName, source.label);
    }
  }
  const recordIcons = usePasswordIconImages(ownerId, visible);
  const scope = { passwords: {
    ...entryDisplay, busy: busy || iconBusy, cannotAdd: busy || iconBusy || configured === false, unconfigured: configured === false,
    nativeAvailable, nativeMessage, error, search, sort, listLoading,
    setupPending: Boolean(setupNotice), setupMessage, setupHasDraft: Boolean(draft), setupCanCreate: !draft && !busy && configured !== false,
    setupCannotCreate: Boolean(draft) || busy || configured === false, setupCannotAttach: !draft || busy || draft.entry.passwordType === 'passkey',
    setupAccount: `Destination: ${typeof window === 'undefined' ? '' : window.location.origin} · Account: ${accountLabel}`,

    records: visible.map(record => ({ id: record.id, title: record.title, type: record.passwordType.replace(/-/g, ' '), hasIcon: Boolean(recordIcons[record.id]), iconMissing: !recordIcons[record.id] })),
    loadingMessage: search.trim() ? 'Searching all password titles…' : 'Refreshing passwords…',
    empty: !listLoading && settledSearch === search && !visible.length,
    emptyMessage: search.trim() ? 'No matching password titles.' : 'Add a login, API key, secure note or authenticator.',
    hasMore: Boolean(cursor && settledSearch === search), cannotLoadMore: listLoading || busy, canRetry: Boolean(error && !listLoading),
    editingEntry: Boolean(draft), editorTitle: draft?.revision ? 'Edit entry' : 'New entry',
    customLabel, customType, cannotAddField: busy || !customLabel.trim(), newEntry: draft?.revision === 0, savedEntry: Boolean(draft?.revision), deleteConfirm,
    transferOpen: transfer !== null, importing: transfer === 'import', exporting: transfer === 'export',
    transferTitle: transfer === 'import' ? 'Import passwords' : 'Export passwords', transferAction: transfer === 'import' ? 'Import entries' : 'Download export',
    importReady: Boolean(imported), importSummary: imported ? `${imported.count} entries and ${imported.fileCount} archive files ready` : '',
    importEntries: (imported?.entries || []).slice(0, 50).map(entry => ({ title: entry.title, type: entry.passwordType.replace(/-/g, ' ') })),
    importMore: imported && imported.count > imported.entries.length ? `and ${imported.count - imported.entries.length} more` : '',
    importWarnings: (imported?.warnings || []).map(message => ({ message })), format, acknowledged, progress,
    cannotTransfer: busy || (transfer === 'import' ? readingImport || !imported || (!imported.count && !imported.fileCount) : !acknowledged)
  } };
  const edit = (change: (entry: PasswordEntry) => PasswordEntry) => { if (!busy && draft) updateEntry(change(draft.entry)); };
  const fieldId = (id: unknown) => typeof id === 'string' && draft?.entry.fields.some(field => field.id === id) ? id : null;
  const move = (id: unknown, direction: number) => edit(entry => {
    const index = entry.fields.findIndex(field => field.id === id), target = index + direction;
    if (index < 0 || target < 0 || target >= entry.fields.length) return entry;
    const fields = [...entry.fields]; [fields[index], fields[target]] = [fields[target], fields[index]]; return { ...entry, fields };
  });
  const receiveSetup = (create: boolean) => run(async () => {
    if (!setupNotice || !setupSession.current || (create ? Boolean(currentDraft.current) : !currentDraft.current || currentDraft.current.entry.passwordType === 'passkey')) return;
    const previous = currentDraft.current, version = generation.current;
    const signal = runSignal.current!, session = setupSession.current;
    const cancel = () => session.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    let value: string;
    try { value = await session.consume(setupNotice.requestId); signal.throwIfAborted(); }
    finally { signal.removeEventListener('abort', cancel); }
    if (!active.current || version !== generation.current || currentDraft.current !== previous) return;
    const base = create ? { id: crypto.randomUUID(), revision: 0, entry: emptyPasswordEntry() } : previous!;
    setDraft({ ...base, entry: { ...base.entry, fields: [...base.entry.fields, { id: crypto.randomUUID(), label: 'Verification code', type: 'totp', value }] } });
    setSetupMessage('Setup added to this draft. Review the account and select Save to keep it.');
  });
  const actions: TransientBlockActions = {
    'setup.create': () => receiveSetup(true),
    'setup.attach': () => receiveSetup(false),
    'setup.retry': () => run(async () => { await refresh(undefined, runSignal.current || undefined); runSignal.current?.throwIfAborted(); setupSession.current?.retry(); }),
    'setup.cancel': () => { setupSession.current?.cancel(); setSetupMessage('Setup cancelled. Your existing draft is unchanged.'); },
    'password.add': () => { if (busy || configured === false) return; clearAndRefresh(); setDraft({ id: crypto.randomUUID(), revision: 0, entry: emptyPasswordEntry() }); },
    'password.import': () => { if (!busy) { clearAndRefresh(); setTransfer('import'); } },
    'password.export': () => { if (!busy) { clearAndRefresh(); setTransfer('export'); } },
    'password.close': clearAndRefresh,
    'password.search': ({ value }) => changeSearch(String(value || '')),
    'password.sort': ({ value }) => { if (value === 'title' || value === 'updated') setSort(value); },
    'password.read': ({ inputs }) => { const record = records.find(record => record.id === inputs.id); if (record) return read(record); },
    'password.more': () => { if (cursor && settledSearch === search && !listLoading) return run(() => refresh(cursor, runSignal.current || undefined)); },
    'password.retry': ({ signal }) => { setError(''); return refresh(undefined, signal).catch(showError); },
    'native.connect': () => run(async () => { const signal = runSignal.current!; const result = await nativePasswordProvider('connect', ownerId); signal.throwIfAborted(); setNativeMessage(result.message); }),
    'native.disconnect': () => run(async () => { const signal = runSignal.current!; const result = await nativePasswordProvider('disconnect', ownerId); signal.throwIfAborted(); setNativeMessage(result.message); }),
    'entry.title': ({ value }) => edit(entry => ({ ...entry, title: String(value || '') })),
    'entry.tags': ({ value }) => edit(entry => ({ ...entry, tags: String(value || '').split('\n') })),
    'entry.type': ({ value }) => { if (value !== 'passkey' && PASSWORD_TYPES.includes(value as any) && draft?.entry.passwordType !== 'passkey') edit(entry => ({ ...entry, passwordType: value as PasswordEntry['passwordType'] })); },
    'entry.favorite': ({ value }) => edit(entry => ({ ...entry, favorite: value === true })),
    'entry.archived': ({ value }) => edit(entry => ({ ...entry, archived: value === true })),
    'entry.save': save,
    'entry.delete': () => { if (draft?.revision) setDeleteConfirm(true); },
    'entry.keep': () => setDeleteConfirm(false),
    'entry.confirm-delete': () => run(async () => { if (!draft || !deleteConfirm) return; await request({ operation: 'delete', id: draft.id, revision: draft.revision }); setRecords(prev => prev.filter(record => record.id !== draft.id)); changed(); clearAndRefresh(); }),
    'field.change': ({ inputs, value }) => { const id = fieldId(inputs.id); if (id) { propertyIdentities.current.delete(id); edit(entry => ({ ...entry, fields: entry.fields.map(field => field.id === id ? { ...field, value: String(value || '') } : field) })); } },
    'field.property': ({ inputs, value, setValidity }) => {
      const id = fieldId(inputs.id), identity = id && propertyIdentities.current.get(id);
      if (!id || !identity || String(identity.epoch) !== String(inputs.epoch) || rawFields[id]) return;
      const source = draft!.entry.fields.find(field => field.id === id)!;
      let patched;
      try { patched = patchPasswordProperty(source, inputs.path, value); }
      catch { setValidity?.('Enter a value with the original property type.'); return; }
      setValidity?.('');
      edit(entry => ({ ...entry, fields: entry.fields.map(field => field.id === id ? patched : field) }));
    },
    'field.mode': ({ inputs }) => { const id = fieldId(inputs.id); if (id && !busy) { propertyIdentities.current.delete(id); setRawFields(previous => ({ ...previous, [id]: !previous[id] })); } },
    'field.copy': async ({ inputs, signal }) => {
      const id = fieldId(inputs.id), source = draft;
      // Resolve values only inside this transient adapter. Passkey fields are
      // deliberately excluded: Copy must never become a signing-key export.
      if (!id || !source || source.entry.passwordType === 'passkey' || busy) return;
      const field = source.entry.fields.find(field => field.id === id)!;
      resetCopy();
      const epoch = copyEpoch.current;
      const current = () => active.current && !signal.aborted && epoch === copyEpoch.current && currentDraft.current === source;
      const cancel = () => { if (epoch === copyEpoch.current) resetCopy(); };
      signal.addEventListener('abort', cancel, { once: true });
      copyCleanup.current = () => signal.removeEventListener('abort', cancel);
      try {
        if (!current()) return;
        // Authenticator Copy always means the current code, never its seed or
        // the countdown text displayed alongside it.
        const value = field.type === 'totp' ? (await totpCode(field.value)).code : field.value;
        if (!current()) return;
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
        if (current()) setCopyFeedback({ [id]: field.type === 'totp' ? 'Verification code copied.' : 'Copied.' });
      } catch {
        // Clipboard/crypto exceptions may include sensitive input. Never show
        // their messages or send them through generic Action error reporting.
        if (current()) setCopyFeedback({ [id]: 'Could not copy. Try again.' });
      }
    },
    'field.reveal': ({ inputs }) => { const id = fieldId(inputs.id); if (id) setRevealed(prev => ({ ...prev, [id]: !prev[id] })); },
    'field.up': ({ inputs }) => move(inputs.id, -1), 'field.down': ({ inputs }) => move(inputs.id, 1),
    'field.remove': ({ inputs }) => edit(entry => ({ ...entry, fields: entry.fields.filter(field => field.id !== inputs.id) })),
    'field.label': ({ value }) => setCustomLabel(String(value || '')),
    'field.type': ({ value }) => { if (FIELD_TYPES.includes(value as FieldType)) setCustomType(value as FieldType); },
    'field.add': () => { if (!customLabel.trim()) return; edit(entry => ({ ...entry, fields: [...entry.fields, { id: crypto.randomUUID(), label: customLabel.trim(), type: customType, value: '' }] })); setCustomLabel(''); },
    'field.noop': () => {},
    'qr.screen': () => run(async () => { const version = generation.current, controller = new AbortController(); controllers.current.add(controller); try { const signal = operationSignal(controller.signal); const result = await scanQrScreen(signal); if (!signal.aborted && version === generation.current) addTotp(result); } finally { controllers.current.delete(controller); } }),
    'qr.file': ({ readFile }) => { const file = readFile('qr-file'); if (file) return run(async () => { const version = generation.current, signal = runSignal.current!, result = await scanQrFile(file, signal); if (!signal.aborted && version === generation.current) addTotp(result); }); },
    'transfer.file': ({ readFile }) => loadImport(readFile('import-file')),
    'transfer.format': ({ value }) => { if (['1pux', '1password', 'chrome', 'apple'].includes(String(value))) setFormat(value as PasswordFormat); },
    'transfer.acknowledge': ({ value }) => setAcknowledged(value === true),
    'transfer.confirm': () => { if (scope.passwords.cannotTransfer) return; return transfer === 'import' ? commitImport() : download(); }
  };
  const scopedActions: TransientBlockActions = Object.fromEntries(Object.entries(actions).map(([name, action]) => [name, invocation => {
    invocation.signal.throwIfAborted(); invocationSignal.current = invocation.signal;
    try { return action(invocation); } finally { invocationSignal.current = null; }
  }]));
  const readPrivateValue = (name: string) => {
    if (name.startsWith('entry-icon-')) return recordIcons[name.slice('entry-icon-'.length)];
    if (!draft) return undefined;
    if (name === 'entry-title') return draft.entry.title;
    if (name === 'entry-tags') return (draft.entry.tags || []).join('\n');
    if (privateProperties.has(name)) return privateProperties.get(name);
    if (name.startsWith('field-')) return draft.entry.fields.find(field => `field-${field.id}` === name)?.value;
    if (name.startsWith('totp-')) { const field = draft.entry.fields.find(field => field.type === 'totp' && `totp-${field.id}` === name); return field ? codes[field.id] || '—' : undefined; }
    return undefined;
  };
  const targetSignature = JSON.stringify(draft?.entry.fields.filter(field => field.type === 'password').map(({ id, label }) => ({ id, label })) || []);
  const generatorTargets = React.useMemo(() => JSON.parse(targetSignature) as Array<{ id: string; label: string }>, [targetSignature]);
  const draftId = draft?.id;
  const generated = React.useCallback((value: string, fieldId: string) => setDraft(current => current?.id === draftId && current.entry.passwordType !== 'passkey' ? { ...current, entry: { ...current.entry, fields: current.entry.fields.map(field => field.id === fieldId && field.type === 'password' ? { ...field, value } : field) } } : current), [draftId]);
  const changeIcon = React.useCallback((icon: PasswordEntry['icon']) => setDraft(current => current?.id === draftId ? { ...current, entry: { ...current.entry, icon } } : current), [draftId]);
  const privateScope = `${scopeKey}:${draft?.id || ''}`;
  return <>
    {setupShown && <SettingsDocumentHost documentKey="password-authenticator-setup" defaultDocument={passwordAuthenticatorSetupBlocks} scopeKey={scopeKey} title="Authenticator setup layout">
      {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={privateScope} scope={scope} actions={scopedActions} enabled={!editing} onError={() => setSetupMessage('Please retry the setup.')}>
        <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
      </TransientBlockHost>}
    </SettingsDocumentHost>}
    <SettingsDocumentHost documentKey="password-manager" defaultDocument={passwordManagerBlocks} upgradeDocument={upgradePasswordManagerBlocks} scopeKey={scopeKey} title="Password manager layout">
      {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={privateScope} scope={scope} actions={scopedActions} enabled={!editing} onError={() => setError('Please try again.')}>
        <TransientPrivateControls scopeKey={privateScope} readValue={readPrivateValue} enabled={!editing}>
          <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
        </TransientPrivateControls>
      </TransientBlockHost>}
    </SettingsDocumentHost>
    <Box width="100%" maxWidth="1100px" mx="auto" px={{ base: 4, md: 6 }}>
      <StablePasswordPasskeySetup ownerId={ownerId} nativeAvailable={nativeAvailable} />
      {draft && <Box border="1px solid var(--tt-border)" borderRadius="12px" p={4} mt={3}>
        <PasswordEntryIcon ownerId={ownerId} entryId={draft.id} icon={draft.entry.icon} />
        {draft.entry.passwordType !== 'passkey' && <StablePasswordGenerator key={`password-generator:${draft.id}`} ownerId={ownerId} origin={window.location.origin} targets={generatorTargets} disabled={busy || iconBusy} onGenerate={generated} />}
        <StablePasswordIconEditor ownerId={ownerId} entryId={draft.id} saved={draft.revision > 0} icon={draft.entry.icon} website={draft.entry.fields.find(field => field.type === 'url')?.value} disabled={busy} onBusyChange={setIconBusy} onChange={changeIcon} />
      </Box>}
    </Box>
    {draft?.entry.onePassword && <PasswordSource key={`source:${draft.id}`} ownerId={ownerId} entryId={draft.id} entry={draft.entry} />}
    {draft && draft.revision > 0 && <PasswordAttachments key={draft.id} ownerId={ownerId} entryId={draft.id} />}
    {draft?.entry.importArchiveId && <PasswordAttachments key={draft.entry.importArchiveId} ownerId={ownerId} entryId={draft.entry.importArchiveId} sourceItem={draft.entry.onePassword} readOnly />}
  </>;
}
