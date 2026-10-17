import React from 'react';
import { Box, Button, Checkbox, Flex, Heading, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Text } from '@chakra-ui/react';
import { Link, useLocation } from 'react-router';
import { DevicePasswordManager } from './DevicePasswordManager';
import type { LocalPasswordVault } from '~/local-workspace/passwordVault';
import { isAnonymousWorkspace, workspaceIdentityKey, subscribeWorkspaceIdentity, announceLocalWorkspaceChange, LOCAL_WORKSPACE_CHANGED } from '~/local-workspace/runtime.client';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { Thingtime } from '~/components/Thingtime/Thingtime';
import type { ThingMods } from '~/components/Thingtime/thingMods';
import { emptyPasswordEntry, FIELD_TYPES, PASSWORD_TYPES, type PasswordEntry, type PasswordMetadata, type FieldType } from '~/passwords/model';
import { passwordRequest } from '~/passwords/client';
import { import1Pux, importPasswordCsv, exportPasswordBackup, type PasswordFormat, type PasswordImport } from '~/passwords/transfer';
import { scanQrFile, scanQrScreen } from '~/passwords/qr.client';
import { hasNativePasswordProvider, nativePasswordProvider } from '~/passwords/native.client';

type Draft = { id: string; revision: number; entry: PasswordEntry };
const changed = () => window.dispatchEvent(new Event('thingtime:passwords-changed'));
const card = { border: '1px solid var(--tt-border, #e6e6eb)', borderRadius: '12px', p: 4, background: 'var(--tt-card, #fff)' };
export function PasswordManager() {
  const user = useCurrentUser(), location = useLocation();
  const identity = React.useSyncExternalStore(subscribeWorkspaceIdentity, workspaceIdentityKey, () => '');
  return <Box width="100%" pt="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))">{isAnonymousWorkspace() ? <DevicePasswordManager key={`${identity}:${location.key}`}>{vault => <PasswordManagerScope ownerId="local-workspace" localVault={vault} />}</DevicePasswordManager> : user && !user.temporary ? <PasswordManagerScope key={`${user.id}:${location.key}`} ownerId={user.id} /> : <Box p={6}><Heading size="md">Passwords</Heading><Text mt={3}>Sign in to unlock your password manager.</Text><Button as={Link} to="/login" mt={3}>Sign in</Button></Box>}</Box>;
}
export function PasswordManagerScope({ ownerId, localVault }: { ownerId: string; localVault?: LocalPasswordVault }) {
  const lopu = useLopu();
  const [records, setRecords] = React.useState<PasswordMetadata[]>([]), [cursor, setCursor] = React.useState<string | null>(null);
  const [configured, setConfigured] = React.useState<boolean | null>(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [draft, setDraft] = React.useState<Draft | null>(null), [customLabel, setCustomLabel] = React.useState(''), [customType, setCustomType] = React.useState<FieldType>('text');
  const [search, setSearch] = React.useState(''), [sort, setSort] = React.useState('title');
  const [transfer, setTransfer] = React.useState<'import' | 'export' | null>(null), [imported, setImported] = React.useState<PasswordImport | null>(null);
  const [format, setFormat] = React.useState<PasswordFormat>('1pux'), [acknowledged, setAcknowledged] = React.useState(false), [progress, setProgress] = React.useState('');
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [nativeAvailable, setNativeAvailable] = React.useState(false), [nativeMessage, setNativeMessage] = React.useState('');
  React.useEffect(() => { const check = () => setNativeAvailable(!localVault && hasNativePasswordProvider()); check(); window.addEventListener('thingtime:native-bridge-ready', check); return () => window.removeEventListener('thingtime:native-bridge-ready', check); }, [localVault]);
  const refreshSequence = React.useRef(0);
  const generation = React.useRef(0), active = React.useRef(true), controllers = React.useRef(new Set<AbortController>());
  const retry = React.useRef<{ payload: string; writeId: string } | null>(null), importPending = React.useRef<{ id: string; writeId: string; entry: PasswordEntry }[]>([]);
  const clear = React.useCallback(() => {
    generation.current++; controllers.current.forEach(controller => controller.abort()); controllers.current.clear();
    setDraft(null); setImported(null); importPending.current = []; retry.current = null; setTransfer(null); setBusy(false); setDeleteConfirm(false); setCustomLabel(''); setAcknowledged(false); setProgress('');
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
    try { let result;
      for (let attempt = 0; ; attempt++) {
        try { result = localVault ? await localVault.request(body, next, controller.signal) : await passwordRequest(ownerId, body, controller.signal, next);
          if (localVault && (body?.operation === 'save' || body?.operation === 'delete')) announceLocalWorkspaceChange(); break; }
        catch (error: any) {
          if (error?.status !== 429 || attempt >= 3 || controller.signal.aborted) throw error;
          setProgress(`Rate limit reached. Continuing in ${error.retryAfter} seconds…`);
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
            const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, error.retryAfter * 1000);
            controller.signal.addEventListener('abort', abort, { once: true });
          });
        }
      } if (!active.current || version !== generation.current) throw new DOMException('Cancelled', 'AbortError'); return result; }
    finally { controllers.current.delete(controller); }
  }, [ownerId, localVault]);
  const refresh = React.useCallback(async (next?: string) => {
    const sequence = ++refreshSequence.current;
    const result = await request(undefined, next); if (sequence !== refreshSequence.current) return; setRecords(prev => next ? [...prev.filter(item => !result.entries.some((entry: PasswordMetadata) => entry.id === item.id)), ...result.entries] : result.entries); setCursor(result.nextCursor); setConfigured(result.configured);
  }, [request]);
  const showError = React.useCallback((reason: any) => { if (reason?.name === 'AbortError' || !active.current) return; if (reason?.status === 401 || (reason?.status === 409 && /account/.test(reason.message))) { clear(); setRecords([]); } setError(reason instanceof Error ? reason.message : 'Please try again.'); }, [clear]);
  React.useEffect(() => { refresh().catch(showError); const check = () => refresh().catch(showError); window.addEventListener('focus', check); if (localVault) window.addEventListener(LOCAL_WORKSPACE_CHANGED, check); return () => { window.removeEventListener('focus', check); window.removeEventListener(LOCAL_WORKSPACE_CHANGED, check); }; }, [refresh, showError, localVault]);
  const run = async (work: () => Promise<void>) => { if (busy) return; const version = generation.current; setBusy(true); setError(''); try { await work(); } catch (reason) { if (version === generation.current) showError(reason); } finally { if (active.current && version === generation.current) setBusy(false); } };
  const updateEntry = (entry: PasswordEntry) => setDraft(prev => prev ? { ...prev, entry } : prev);
  const addTotp = (value: string) => setDraft(prev => prev ? { ...prev, entry: { ...prev.entry, fields: [...prev.entry.fields, { id: crypto.randomUUID(), label: 'Verification code', type: 'totp', value }] } } : prev);
  const save = () => run(async () => {
    if (!draft) return;
    const payload = JSON.stringify(draft); if (retry.current?.payload !== payload) retry.current = { payload, writeId: crypto.randomUUID() };
    const result = await request({ operation: 'save', ...draft, writeId: retry.current.writeId });
    retry.current = null; setDraft(prev => prev?.id === draft.id ? { ...prev, revision: result.record.revision } : prev);
    setRecords(prev => [...prev.filter(item => item.id !== result.record.id), result.record]); changed(); lopu({ title: 'Password entry saved', status: 'success' });
  });
  const read = (record: PasswordMetadata) => run(async () => { const result = await request({ operation: 'read', id: record.id }); setDraft({ id: result.id, revision: result.revision, entry: result.entry }); retry.current = null; setDeleteConfirm(false); });
  const loadImport = async (file?: File) => {
    if (!file || busy) return; const version = generation.current; setError('');
    try { if (file.size > 20 * 1024 * 1024) throw new Error('Import at most 20 MiB at a time.'); const result = file.name.toLowerCase().endsWith('.1pux') ? import1Pux(new Uint8Array(await file.arrayBuffer())) : importPasswordCsv(await file.text());
      if (!active.current || generation.current !== version) return; setImported(result); importPending.current = result.entries.map(entry => ({ entry, id: crypto.randomUUID(), writeId: crypto.randomUUID() }));
    } catch { setError('The file could not be imported. Check its format and entry sizes.'); }
  };
  const commitImport = () => run(async () => {
    const total = importPending.current.length;
    while (importPending.current.length) { const item = importPending.current[0]; await request({ operation: 'save', ...item, revision: 0 }); importPending.current.shift(); setProgress(`${total - importPending.current.length} of ${total} saved`); }
    setImported(null); setTransfer(null); await refresh(); changed(); lopu({ title: 'Password import complete', status: 'success' });
  });
  const download = () => run(async () => {
    const values: PasswordEntry[] = []; let next: string | undefined;
    do { const page = await request({ operation: 'export', ...(next ? { cursor: next } : {}) }); values.push(...page.entries.map((record: { entry: PasswordEntry }) => record.entry)); next = page.nextCursor || undefined; setProgress(`${values.length} entries prepared`); } while (next);
    const result = exportPasswordBackup(values, format), blob = new Blob([result.bytes as BlobPart], { type: result.mime }), url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `thingtime-passwords.${result.extension}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setTransfer(null); setAcknowledged(false); setProgress('');
  });
  const visible = records.filter(record => record.title.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title));
  return <Box width="100%" maxWidth="1100px" mx="auto" px={{ base: 3, md: 6 }} py={6}>
    <Flex gap={3} alignItems="center" justifyContent="space-between" flexWrap="wrap"><Box><Heading size="lg">Passwords</Heading><Text mt={1} color="var(--tt-muted)">{localVault ? 'Encrypted on this device · never uploaded' : 'Unlocked with your Thingtime session'}</Text></Box><Flex gap={2} flexWrap="wrap"><Button onClick={() => { clear(); setDraft({ id: crypto.randomUUID(), revision: 0, entry: emptyPasswordEntry() }); }} isDisabled={busy || configured === false}>Add password</Button><Button variant="outline" onClick={() => { clear(); setTransfer('import'); }}>Import</Button><Button variant="outline" onClick={() => { clear(); setTransfer('export'); }}>Export</Button><Button variant="ghost" onClick={clear}>Hide values</Button>{localVault && <Button variant="outline" onClick={() => localVault.lock()}>Lock vault</Button>}</Flex></Flex>
    {configured === false && <Text mt={4}>Password encryption needs deployment configuration before you can save entries.</Text>}
    {nativeAvailable && <Box mt={4}><Text fontSize="sm">Use the native Thingtime app to fill passwords, verification codes, and create or use passkeys in other apps and websites.</Text><Flex gap={2} mt={2} flexWrap="wrap"><Button size="sm" onClick={() => run(async () => { const result = await nativePasswordProvider('connect', ownerId); setNativeMessage(result.message); })}>Connect Password AutoFill</Button><Button size="sm" variant="ghost" onClick={() => run(async () => { const result = await nativePasswordProvider('disconnect', ownerId); setNativeMessage(result.message); })}>Disconnect AutoFill</Button></Flex>{nativeMessage && <Text role="status" mt={2} fontSize="sm">{nativeMessage}</Text>}</Box>}
    {error && <Text role="alert" color="red.600" mt={4}>{error}</Text>}
    <Flex gap={5} mt={6} alignItems="start" direction={{ base: 'column', md: 'row' }}>
      <Box width={{ base: '100%', md: draft ? '34%' : '100%' }} minWidth={0}>
        <Flex gap={2} mb={3}><Input aria-label="Search passwords" placeholder="Search loaded entries" value={search} onChange={event => setSearch(event.target.value)} /><Select maxWidth="150px" aria-label="Sort passwords" value={sort} onChange={event => setSort(event.target.value)}><option value="title">Title</option><option value="updated">Recently edited</option></Select></Flex>
        <Flex direction="column" gap={2}>{visible.map(record => <Box {...card} key={record.id} as="button" textAlign="left" width="100%" disabled={busy} onClick={() => read(record)}><Text fontWeight={600} overflowWrap="anywhere">{record.title}</Text><Text fontSize="sm" color="var(--tt-muted)">{record.passwordType.replace(/-/g, ' ')}</Text></Box>)}</Flex>
        {!records.length && <Text py={5}>Add a login, API key, secure note or authenticator.</Text>}
        {cursor && <Button mt={3} onClick={() => run(() => refresh(cursor))} isLoading={busy}>Load more</Button>}
      </Box>
      {draft && <Box {...card} flex={1} width={{ base: '100%', md: 'auto' }} minWidth={0}>
        <Flex justifyContent="space-between" mb={4}><Heading size="md">{draft.revision ? 'Edit entry' : 'New entry'}</Heading><Button size="sm" onClick={clear}>Close</Button></Flex>
        <Text as="label" htmlFor="password-title">Title</Text><Input id="password-title" value={draft.entry.title} maxLength={160} onChange={event => updateEntry({ ...draft.entry, title: event.target.value })} mb={3} />
        <Text as="label" htmlFor="password-type">Password type</Text><Select id="password-type" isDisabled={draft.entry.passwordType === 'passkey'} value={draft.entry.passwordType} onChange={event => updateEntry({ ...draft.entry, passwordType: event.target.value as PasswordEntry['passwordType'] })} mb={4}>{PASSWORD_TYPES.filter(type => type !== 'passkey' || draft.entry.passwordType === 'passkey').map(type => <option key={type} value={type}>{type.replace(/-/g, ' ')}</option>)}</Select>
        {draft.entry.passwordType === 'passkey' && <Text fontSize="sm" mb={4}>This passkey was created by the native Thingtime provider. Keep its signing fields intact to continue signing in.</Text>}
        {draft.entry.passwordType === 'passkey-reference' && <Text fontSize="sm" mb={4}>Record the site and where an existing passkey is stored. This reference does not contain a passkey. New passkeys use the native credential provider.</Text>}
        <Thingtime thing={Object.fromEntries(draft.entry.fields.map(field => [field.id, field.value]))} mods={{ layout: 'fields', fields: draft.entry.fields.map(({ value: _value, ...field }) => field), sortable: true, removable: true, revealSecrets: true }} onChange={(values: Record<string, string>) => updateEntry({ ...draft.entry, fields: draft.entry.fields.map(field => ({ ...field, value: values[field.id] ?? '' })) })} onModsChange={(mods: ThingMods) => updateEntry({ ...draft.entry, fields: mods.fields.map(field => ({ ...field, value: draft.entry.fields.find(item => item.id === field.id)?.value ?? '' })) })} />
        <Flex gap={2} flexWrap="wrap" mt={5}><Input flex="1 1 150px" aria-label="Custom field label" placeholder="Custom field label" maxLength={120} value={customLabel} onChange={event => setCustomLabel(event.target.value)} /><Select flex="1 1 120px" aria-label="Custom field type" value={customType} onChange={event => setCustomType(event.target.value as FieldType)}>{FIELD_TYPES.map(type => <option key={type}>{type}</option>)}</Select><Button isDisabled={!customLabel.trim() || draft.entry.fields.length >= 64} onClick={() => { updateEntry({ ...draft.entry, fields: [...draft.entry.fields, { id: crypto.randomUUID(), label: customLabel.trim(), type: customType, value: '' }] }); setCustomLabel(''); }}>Add custom field</Button></Flex>
        <Box mt={5}><Text fontWeight={600}>Authenticator setup</Text><Text fontSize="sm" mt={1}>Import a TOTP setup QR code. Screen scanning asks you to choose the screen or tab to capture; images are processed on this device.</Text><Flex gap={2} mt={2} flexWrap="wrap"><Button size="sm" onClick={() => run(async () => { const version = generation.current, controller = new AbortController(); controllers.current.add(controller); try { const result = await scanQrScreen(controller.signal); if (version === generation.current) addTotp(result); } finally { controllers.current.delete(controller); } })}>Scan QR code on screen</Button><Button as="label" size="sm" cursor="pointer">Upload QR code<Input type="file" accept="image/png,image/jpeg,image/webp" display="none" aria-label="Upload QR code" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) run(async () => { const version = generation.current, result = await scanQrFile(file); if (version === generation.current) addTotp(result); }); }} /></Button></Flex></Box>
        <Flex gap={2} mt={6} justifyContent="space-between" flexWrap="wrap"><Button isLoading={busy} onClick={save}>Save entry</Button>{draft.revision > 0 && <Button colorScheme="red" variant="ghost" onClick={() => setDeleteConfirm(true)}>Delete entry</Button>}</Flex>
        {deleteConfirm && <Box mt={3}><Text>Delete this entry and its saved secrets?</Text><Flex gap={2} mt={2}><Button size="sm" onClick={() => run(async () => { await request({ operation: 'delete', id: draft.id, revision: draft.revision }); setRecords(prev => prev.filter(record => record.id !== draft.id)); changed(); clear(); })}>Confirm delete</Button><Button size="sm" variant="ghost" onClick={() => setDeleteConfirm(false)}>Keep entry</Button></Flex></Box>}
      </Box>}
    </Flex>
    <Modal isOpen={transfer !== null} onClose={clear} size="xl"><ModalOverlay /><ModalContent mx={3}><ModalHeader>{transfer === 'import' ? 'Import passwords' : 'Export passwords'}</ModalHeader><ModalCloseButton /><ModalBody>
      {transfer === 'import' ? <><Text>Choose a 1Password .1pux or CSV export, Chrome CSV, or Apple Passwords CSV. Preview before saving. Imported entries remain private.</Text><Input mt={3} type="file" accept=".csv,.1pux" aria-label="Import password file" isDisabled={busy} onChange={event => { loadImport(event.target.files?.[0]); event.target.value = ''; }} />{imported && <Box mt={3}><Text fontWeight={600}>{imported.entries.length} entries ready</Text><Box maxHeight="180px" overflowY="auto" mt={2}>{imported.entries.slice(0, 50).map((entry, index) => <Text key={index} fontSize="sm" overflowWrap="anywhere">{entry.title} · {entry.passwordType.replace(/-/g, ' ')}</Text>)}{imported.entries.length > 50 && <Text fontSize="sm">and {imported.entries.length - 50} more</Text>}</Box>{imported.warnings.map(warning => <Text key={warning} fontSize="sm" mt={2}>{warning}</Text>)}<Text fontSize="sm" mt={2}>Keep your source vault until you have checked the imported entries.</Text></Box>}</> : <><Select aria-label="Export format" value={format} onChange={event => setFormat(event.target.value as PasswordFormat)}><option value="1pux">1Password 1PUX (custom fields)</option><option value="1password">1Password CSV</option><option value="chrome">Chrome CSV</option><option value="apple">Apple Passwords CSV</option></Select><Text mt={3}>Large vaults download as a ZIP: extract it and import each numbered file once. Exports contain unencrypted passwords. CSV omits custom fields; Chrome CSV also omits authenticator secrets. CSV does not transfer passkeys. Thingtime 1PUX backups preserve passkey fields for restoring to Thingtime; other password managers may import them only as custom data. Use 1PUX to keep custom fields, and delete the export after transferring it.</Text><Checkbox mt={3} isChecked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}>I understand the downloaded file contains unencrypted secrets.</Checkbox></>}
      {progress && <Text mt={3}>{progress}</Text>}{error && <Text role="alert" color="red.600" mt={3}>{error}</Text>}
    </ModalBody><ModalFooter gap={2}><Button variant="ghost" onClick={clear}>Cancel</Button><Button isLoading={busy} isDisabled={transfer === 'import' ? !imported?.entries.length : !acknowledged} onClick={transfer === 'import' ? commitImport : download}>{transfer === 'import' ? 'Import entries' : 'Download export'}</Button></ModalFooter></ModalContent></Modal>
  </Box>;
}
