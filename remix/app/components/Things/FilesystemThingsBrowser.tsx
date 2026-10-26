import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Checkbox, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Progress, Select, Text } from '@chakra-ui/react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useWorkspaceUser } from '~/hooks/useWorkspaceUser';
import { useApi } from '~/hooks/useApi';
import { LOCAL_WORKSPACE_CHANGED, workspaceIdentityKey, subscribeWorkspaceIdentity, currentAccountWorkspace, accountRemoteWorkspaceLease } from '~/local-workspace/runtime.client';
import { formatAttachmentBytes } from '../Attachments/attachmentUiCore';
import { FILESYSTEM_MAX_BYTES, filesystemPath } from '~/api/utils/devices/deviceFilesystemCore';
import { ThingsGridView, ThingsListView, type ThingsItemAction, type ThingsItemHandlers } from './ThingsViews';
import { isFolder, thingDisplayName, type ThingsThing } from './thingsCore';
import { fileRequest, filesystemClipboard, remoteEntryThing, remoteFileCommand, readRemoteFile, writeRemoteFile, requireFilesystemCapabilities, type FileApproval, type FileLocation } from './filesystemClient';
import { filesystemName, itemLocation, transferFilesystem } from './filesystemTransfer';
import { bundleFromPlan } from '~/utils/thingTransfer/browser';
import { ThingContextMenu } from '../Thingtime/ContextMenu/ThingContextMenu';
import { useThingContextMenu } from '../Thingtime/ContextMenu/useThingContextMenu';
import { TRANSFER_DIALOG_Z, TRANSFER_MENU_Z } from './transferLayers';

const listings = new Map<string, ThingsThing[]>();
const locationKey = (owner: string, location: FileLocation) => `${owner}:${JSON.stringify(location)}`;
const join = (path: string, name: string) => path ? `${path}/${name}` : name;
const failure = (error: unknown) => error instanceof Error ? error.message : 'The file operation failed.';
const saveFile = (file: File) => {
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
type Props = { deviceId?: string; initialPath?: string; initialFolderId?: string | null; compact?: boolean; onLocationChange?: (location: FileLocation) => void };

/** The same Things items, selection, grid/list and action menu in every host.
 * Remote inode metadata stays ephemeral and scoped to the signed-in owner. */
export const FilesystemThingsBrowser = (props: Props) => {
  const identity = React.useSyncExternalStore(subscribeWorkspaceIdentity, workspaceIdentityKey, workspaceIdentityKey);
  return identity ? <FilesystemThingsContent key={identity} identity={identity} {...props} /> : <Text padding={4}>Your workspace is not ready. Reload to try again.</Text>;
};

const FilesystemThingsContent = ({ deviceId, initialPath = '', initialFolderId = null, compact = false, onLocationChange, identity }: Props & { identity: string }) => {
  const user = useWorkspaceUser();
  const ownerId = user?.id || '';
  const localOnly = !!user?.localOnly;
  const api = useApi(), apiRef = useRef(api); apiRef.current = api;
  const [location, setLocation] = useState<FileLocation>(() => deviceId ? { deviceId, path: initialPath } : { folderId: initialFolderId });
  useEffect(() => {
    setLocation(current => (current.deviceId === deviceId && (deviceId ? current.path === initialPath : current.folderId === initialFolderId)) ? current : (deviceId ? { deviceId, path: initialPath } : { folderId: initialFolderId }));
  }, [deviceId, initialPath, initialFolderId]);
  const fileLimit = location.deviceId ? FILESYSTEM_MAX_BYTES : null;
  const [history, setHistory] = useState<FileLocation[]>([]);
  const [items, setItems] = useState<ThingsThing[]>(() => listings.get(locationKey(identity, location)) || []);
  const [devices, setDevices] = useState<Array<{ id: string; name: string; capabilities: string[] }>>([]);
  const [view, setView] = useState<'grid' | 'list'>(compact ? 'list' : 'grid');
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [sort, setSort] = useState('name');
  const [hidden, setHidden] = useState(false), [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState(() => filesystemClipboard.get(identity));
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number | null>(null), [name, setName] = useState(''), [creating, setCreating] = useState(false);
  const [approval, setApproval] = useState<{ id: string; prompt: string; decide: (yes: boolean) => void } | null>(null);
  const [popup, setPopup] = useState(false);
  const contextMenu = useThingContextMenu();
  const [contextItem, setContextItem] = useState<ThingsThing | null>(null);
  const active = useRef(false), refreshVersion = useRef(0);
  const operation = useRef<AbortController | null>(null), picker = useRef<HTMLInputElement>(null), mounted = useRef(true);
  const withRemote = useCallback(async <T,>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>, pairedDevice = true): Promise<T> => {
    const scope = currentAccountWorkspace();
    if (!scope || workspaceIdentityKey() !== identity) throw new Error('Reconnect and verify your account before using remote files.');
    const lease = accountRemoteWorkspaceLease(scope), controller = new AbortController();
    lease.assertCurrent(); signal.throwIfAborted();
    const abort = () => controller.abort();
    const unsubscribe = lease.onInvalidate(abort); signal.addEventListener('abort', abort, { once: true });
    try {
      if (pairedDevice) await requireFilesystemCapabilities();
      lease.assertCurrent(); controller.signal.throwIfAborted();
      const result = await work(controller.signal); lease.assertCurrent(); controller.signal.throwIfAborted(); return result;
    } finally { unsubscribe(); signal.removeEventListener('abort', abort); }
  }, [identity]);
  useEffect(() => {
    mounted.current = true;
    const update = () => setClipboard(filesystemClipboard.get(identity));
    update(); window.addEventListener('thingtime-files-clipboard', update);
    return () => { mounted.current = false; operation.current?.abort(); window.removeEventListener('thingtime-files-clipboard', update); };
  }, [identity]);
  useEffect(() => {
    if (!ownerId || localOnly || user?.offline) return;
    const controller = new AbortController();
    void withRemote(controller.signal, signal => fileRequest('/api/v1/devices', undefined, signal)).then(result => setDevices(result.devices || [])).catch(() => {});
    return () => controller.abort();
  }, [ownerId, localOnly, user?.offline, withRemote]);
  const approve: FileApproval = useCallback((request, signal) => new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { setApproval(null); reject(new DOMException('Cancelled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    setApproval({ ...request, decide: async yes => {
      setApproval(null); signal.removeEventListener('abort', abort);
      try {
        await withRemote(signal, remoteSignal => fileRequest('/api/v1/devices/approvals', { approvalId: request.id, decision: yes ? 'approved' : 'denied' }, remoteSignal));
        if (yes) resolve(); else reject(new Error('Device action declined.'));
      } catch (e) { reject(e); }
    } });
  }), [withRemote]);
  const list = useCallback(async (target: FileLocation, signal: AbortSignal, includeHidden = hidden, includeAccount = true) => {
    signal.throwIfAborted();
    if (localOnly && target.deviceId) throw new Error('Paired devices require a signed-in account. Your local files stay on this device.');
    const result: ThingsThing[] = [];
    if (target.deviceId) {
      await withRemote(signal, async signal => {
      let cursor: number | undefined;
      do {
        const page = await remoteFileCommand(target.deviceId, { op: 'list', path: target.path, hidden: includeHidden, ...(cursor === undefined ? {} : { cursor }) }, signal, approve);
        result.push(...page.entries!.map(entry => remoteEntryThing(target.deviceId, entry)));
        cursor = page.nextCursor ?? undefined;
        if (result.length > 10_000) throw new Error('This directory is too large to browse.');
      } while (cursor !== undefined);
      });
    } else {
      const readPages = async (device: boolean) => {
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          signal.throwIfAborted();
          const page = await apiRef.current.v1.things.list({ folder: target.folderId || 'root', limit: 100, cursor, ...(device ? { device: true } : {}) }, { signal });
          result.push(...page.things); cursor = page.nextCursor || undefined;
          if (result.length > 20_000 || (cursor && seen.has(cursor))) throw new Error('This folder is too large to browse.');
          if (cursor) seen.add(cursor);
        } while (cursor);
      };
      await readPages(!localOnly);
      if (includeAccount && !localOnly && !user?.offline && navigator.onLine !== false) {
        try { await readPages(false); }
        catch (error) { signal.throwIfAborted(); setError(`Showing files saved on this device. Account refresh failed: ${failure(error)}`); }
      }
    }
    return [...new Map(result.map(row => [row.id, row])).values()];
  }, [approve, hidden, localOnly, user?.offline, withRemote]);
  const refresh = useCallback(async (signal: AbortSignal) => {
    const version = ++refreshVersion.current;
    const key = locationKey(identity, location);
    const show = (fresh: ThingsThing[]) => {
      signal.throwIfAborted();
      if (version !== refreshVersion.current) return;
      listings.delete(key); listings.set(key, fresh);
      while (listings.size > 12) listings.delete(listings.keys().next().value!);
      setItems(fresh);
    };
    const local = await list(location, signal, hidden, false);
    // Existing online-only files remain visible while their authorized list
    // refreshes. Device writes complete independently of that network read.
    const retained = !location.deviceId ? (listings.get(key) || []).filter(row => row.thingtime.includes('attachment') && !row.id.startsWith('local-')) : [];
    show([...retained, ...local]);
    if (!location.deviceId && !localOnly && !user?.offline && navigator.onLine !== false)
      void list(location, signal).then(show).catch(error => { if (!signal.aborted) setError(failure(error)); });
  }, [list, location, identity, hidden, localOnly, user?.offline]);

  useEffect(() => {
    if (!ownerId) return;
    const controller = new AbortController();
    operation.current = controller; setItems(listings.get(locationKey(identity, location)) || []); setSelected(new Set()); setLoading(true); setError('');
    void refresh(controller.signal).catch(e => { if (!controller.signal.aborted) setError(failure(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh, ownerId, identity, location]);
  useEffect(() => {
    let controller: AbortController | undefined;
    const update = () => {
      if (active.current || location.deviceId) return;
      controller?.abort(); controller = new AbortController();
      const signal = controller.signal;
      void refresh(signal).catch(error => { if (!signal.aborted) setError(failure(error)); });
    };
    window.addEventListener(LOCAL_WORKSPACE_CHANGED, update);
    return () => { controller?.abort(); window.removeEventListener(LOCAL_WORKSPACE_CHANGED, update); };
  }, [refresh, location.deviceId]);
  const go = (next: FileLocation, back = false) => {
    if (busy) return;
    if (!back) setHistory(current => [...current, location]);
    setQuery(''); contextMenu.closeMenu(); setLocation(next); onLocationChange?.(next);
  };
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return false;
    active.current = true;
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setLoading(false); setError(''); setStatus(''); setProgress(null);
    try { await work(controller.signal); controller.signal.throwIfAborted(); await refresh(controller.signal); setStatus('Done'); return true; }
    catch (e) { if (mounted.current) { setStatus(''); setError(controller.signal.aborted ? 'Stopped waiting. An accepted device action or upload may still finish. Refresh before retrying; source files were kept unless their completed move was already confirmed.' : failure(e)); } return false; }
    finally { active.current = false; if (mounted.current) { setBusy(false); setProgress(null); } }
  };
  const progressFor = (filename: string) => (done: number, total: number) => { setStatus(filename); setProgress(total ? done / total * 100 : 100); };
  const read = async (item: ThingsThing, signal: AbortSignal) => {
    if (localOnly && item.inode) throw new Error('Paired devices require a signed-in account.');
    if (item.inode) return withRemote(signal, remoteSignal => readRemoteFile(item.inode!.deviceId, item.inode!, remoteSignal, approve, progressFor(filesystemName(item))));
    if (!item.thingtime.includes('attachment')) throw new Error('Select a file.');
    if (localOnly || item.id.startsWith('local-file-')) {
      const result = await apiRef.current.v1.attachments.readLocalFile({ id: item.id }, { signal, format: 'blob' });
      signal.throwIfAborted();
      return new File([result.blob], filesystemName(item), { type: String(result.attachment.contentType) });
    }
    // Account files use the canonical scoped export adapter. Device command
    // buffers/capabilities do not govern an ordinary Thingtime file download.
    return withRemote(signal, async remoteSignal => {
      const result = await apiRef.current.v1.things.export({ ids: [item.id], includeChildren: false, includeDependencies: false, includeLinks: false }, { signal: remoteSignal });
      if (!result?.ok) throw new Error(result?.error || 'The file could not be downloaded.');
      const bundle = await bundleFromPlan(result.plan, { originalStream: true, signal: remoteSignal });
      const file = bundle.manifest.files[0];
      if (bundle.manifest.roots.length !== 1 || bundle.manifest.files.length !== 1 || file.targetId !== bundle.manifest.roots[0] || file.bytes !== Number(item.crystal.size))
        throw new Error('The file changed while downloading. Refresh and try again.');
      return new File([bundle.files.get(file.id)!], filesystemName(item), { type: file.mime });
    }, false);
  };
  const bulk = async (op: string, chosen: ThingsThing[], target: FileLocation, signal: AbortSignal) => {
    if (target.deviceId) throw new Error('Choose a Thingtime folder.');
    signal.throwIfAborted();
    const localFiles = !localOnly ? chosen.filter(item => item.id.startsWith('local-file-')) : [];
    if (localFiles.length && op !== 'move') throw new Error('Copy files through the file browser.');
    for (const item of localFiles) { signal.throwIfAborted(); await apiRef.current.v1.attachments.moveLocalFile({ id: item.id, folderId: target.folderId || null }); }
    const rest = chosen.filter(item => !localFiles.includes(item));
    if (!rest.length) return;
    const result = await apiRef.current.v1.things.bulk({ op: op as 'move' | 'copy' | 'delete', ids: rest.map(item => item.id), folderId: target.folderId });
    if (result.failed || result.results?.some((entry: any) => !entry.ok)) throw new Error(result.results?.find((entry: any) => !entry.ok)?.error || 'Some items could not be moved. Refresh to inspect the completed items.');
  };
  const mkdir = async (target: FileLocation, folderName: string, signal: AbortSignal): Promise<FileLocation> => {
    if (!filesystemPath(folderName) || !folderName || folderName.includes('/')) throw new Error('Choose a folder name without slashes.');
    if (localOnly && target.deviceId) throw new Error('Paired devices require a signed-in account.');
    if (target.deviceId) {
      const path = join(target.path, folderName); await withRemote(signal, remoteSignal => remoteFileCommand(target.deviceId!, { op: 'mkdir', path }, remoteSignal, approve)); return { deviceId: target.deviceId, path };
    }
    signal.throwIfAborted();
    const result = await apiRef.current.v1.things.create({ thingtime: ['folder'], crystal: { name: folderName }, folderId: target.folderId });
    return { folderId: result.thing?.id || result.id };
  };
  const write = async (target: FileLocation, file: File, signal: AbortSignal) => {
    setStatus(`Saving ${file.name}`);
    if (target.deviceId) {
      if (localOnly) throw new Error('Paired devices require a signed-in account.');
      return withRemote(signal, remoteSignal => writeRemoteFile(target.deviceId!, join(target.path!, file.name), file, remoteSignal, approve, progressFor(file.name)));
    }
    signal.throwIfAborted();
    await apiRef.current.v1.attachments.saveLocalFile({ requestId: crypto.randomUUID(), name: file.name, contentType: file.type || 'application/octet-stream', bytes: file, folderId: target.folderId }, { signal });
  };

  const copy = (mode: 'copy' | 'cut', chosen = items.filter(item => selected.has(item.id))) => {
    if (!chosen.length || busy) return;
    filesystemClipboard.set({ ownerId: identity, mode, location, items: chosen }); setStatus(`${chosen.length} selected for ${mode === 'copy' ? 'copy' : 'move'}. Choose a destination and paste.`);
  };
  const paste = (target = location) => {
    const source = filesystemClipboard.get(identity);
    if (!source) return;
    void run(async signal => {
      await transferFilesystem(source, target, {
        list: where => list(where, signal, true), check: () => signal.throwIfAborted(),
        mkdir: (where, title) => mkdir(where, title, signal), read: item => read(item, signal), write: (where, file) => write(where, file, signal),
        remove: async item => {
          signal.throwIfAborted();
          if (localOnly) { await apiRef.current.v1.things.bulk({ op: 'delete', ids: [item.id] }); return; }
          if (item.inode) await withRemote(signal, remoteSignal => remoteFileCommand(item.inode!.deviceId, { op: 'trash', path: item.inode!.path, version: item.inode!.version }, remoteSignal, approve));
          else if (isFolder(item) || item.id.startsWith('local-file-')) await apiRef.current.v1.things.remove({ id: item.id });
          else await withRemote(signal, remoteSignal => fileRequest('/api/v1/attachments/delete', { id: item.id }, remoteSignal));
        },
        nativeMove: async (chosen, where) => {
          if (localOnly && where.deviceId) throw new Error('Paired devices require a signed-in account.');
          if (where.deviceId) for (const item of chosen) {
            if (!item.inode) throw new Error('Select files on the source device.');
            await withRemote(signal, remoteSignal => remoteFileCommand(where.deviceId!, { op: 'move', path: item.inode!.path, version: item.inode!.version, destination: join(where.path!, item.inode!.name) }, remoteSignal, approve));
          } else await bulk('move', chosen, where, signal);
        }
      });
      if (source.mode === 'cut') filesystemClipboard.set(null);
    });
  };
  const open = (item: ThingsThing) => {
    if (isFolder(item)) go(itemLocation(item));
    else void run(async signal => saveFile(await read(item, signal)));
  };
  const action = (item: ThingsThing, verb: ThingsItemAction) => {
    const chosen = selected.has(item.id) ? items.filter(entry => selected.has(entry.id)) : [item];
    if (verb === 'copy' || verb === 'cut') copy(verb, chosen);
    else if (verb === 'paste-into') paste(itemLocation(item));
    else if (verb === 'open' || verb === 'download') open(item);
  };
  const visible = useMemo(() => items.filter(item => (isFolder(item) || item.inode || item.thingtime.includes('attachment')) &&
    filesystemName(item).toLowerCase().includes(query.toLowerCase()) && (kind === 'all' || (kind === 'folder') === isFolder(item)))
    .sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || (sort === 'newest' ? Date.parse(b.updatedAt) - Date.parse(a.updatedAt) : filesystemName(a).localeCompare(filesystemName(b)))), [items, query, kind, sort]);
  const handlers: ThingsItemHandlers = {
    compact: true, menuZIndex: TRANSFER_MENU_Z + 2,
    itemHref: item => item.inode ? `/things?files=${encodeURIComponent(item.inode.deviceId)}&path=${encodeURIComponent(isFolder(item) ? item.inode.path : location.path || '')}` : `/things?files=thingtime${isFolder(item) ? `&folder=${encodeURIComponent(item.id)}` : location.folderId ? `&folder=${encodeURIComponent(location.folderId)}` : ''}`,
    ownerId, selected, cutIds: new Set(clipboard?.mode === 'cut' ? clipboard.items.map(item => item.id) : []), isMobile: true,
    onItemClick: item => setSelected(current => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; }),
    onItemOpen: open, onItemToggle: item => setSelected(current => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; }),
    onItemAction: action, onItemContextMenu: (item, event) => { setContextItem(item); contextMenu.openAtPointer(event); },
    onItemDragStart: (_item, event) => event.preventDefault(), onItemDragEnd: () => {}, dropTargetId: undefined,
    onFolderDragOver: () => {}, onFolderDragLeave: () => {}, onFolderDrop: () => {},
    itemMenuFor: item => ({ sections: [{ id: 'files', actions: [
      { id: 'open', command: 'open', label: isFolder(item) ? 'Open folder' : 'Download', icon: isFolder(item) ? '📁' : '📥', disabled: busy || (!!item.inode && !['folder', 'file'].includes(item.inode.type)) },
      { id: 'copy', command: 'copy', label: 'Copy', icon: '📋', disabled: busy },
      { id: 'cut', command: 'cut', label: 'Cut to move', icon: '✂️', disabled: busy },
      ...(isFolder(item) ? [{ id: 'paste-into', command: 'paste-into', label: 'Paste into folder', icon: '📥', disabled: busy || !clipboard }] : [])
    ] }] })
  };
  if (!ownerId) return <Text padding={4}>Your workspace is not ready. Reload to try again.</Text>;
  return <Box data-testid="filesystem-browser" minWidth={0} width="100%" onKeyDown={event => {
    if (!(event.ctrlKey || event.metaKey) || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
    if (['c', 'x', 'v'].includes(event.key.toLowerCase())) { event.preventDefault(); event.key.toLowerCase() === 'v' ? paste() : copy(event.key.toLowerCase() === 'x' ? 'cut' : 'copy'); }
  }} tabIndex={0}>
    <Flex align="center" gap={2} wrap="wrap" marginBottom={3}>
      <Text as="h2" fontSize={compact ? '16px' : '25px'} fontWeight={700}>Files</Text>
      <Box flex={1} />
      {compact && <Button size="xs" variant="ghost" onClick={() => setPopup(true)}>Expand</Button>}
      <Button as={Link} to="/things" size="xs" variant="ghost">All Things</Button>
    </Flex>
    <Flex gap={2} wrap="wrap" marginBottom={2}>
      <Select aria-label="File location" size="sm" minWidth={0} flex="1 1 160px" maxWidth="100%" value={location.deviceId || 'thingtime'} isDisabled={busy} onChange={e => { setHistory([]); go(e.target.value === 'thingtime' ? { folderId: null } : { deviceId: e.target.value, path: '' }); }}>
        <option value="thingtime">{localOnly ? "Files on this device" : "Your Thingtime"}</option>
        {location.deviceId && !devices.some(d => d.id === location.deviceId) && <option value={location.deviceId}>Remote device</option>}
        {devices.map(device => <option key={device.id} value={device.id} disabled={!device.capabilities?.includes('filesystem.v1')}>{device.name || 'Device'}{device.capabilities?.includes('filesystem.v1') ? '' : ' · update node to browse'}</option>)}
      </Select>
      <Button size="sm" variant="outline" isDisabled={busy || loading} onClick={() => void run(async () => {})}>Refresh</Button>
    </Flex>
    <Flex align="center" gap={2} marginBottom={3} minWidth={0}>
      <Button size="xs" isDisabled={busy || !history.length} onClick={() => { const previous = history.at(-1)!; setHistory(current => current.slice(0, -1)); go(previous, true); }}>Back</Button>
      <Button size="xs" variant="ghost" isDisabled={busy} onClick={() => go(location.deviceId ? { deviceId: location.deviceId, path: '' } : { folderId: null })}>{location.deviceId ? 'Home' : 'Root'}</Button>
      <Text fontSize="12px" minWidth={0} overflowWrap="anywhere">{location.deviceId ? location.path || 'Home folder' : location.folderId ? location.label || 'Thingtime folder' : 'Your files and folders'}</Text>
    </Flex>
    <Flex gap={2} wrap="wrap" marginBottom={3}>
      <Input aria-label="Filter files" placeholder="Filter files and folders" size="sm" value={query} onChange={e => setQuery(e.target.value)} minWidth={0} flex="1 1 170px" />
      <Select aria-label="File type" size="sm" width="auto" value={kind} onChange={e => setKind(e.target.value)}><option value="all">All types</option><option value="folder">Folders</option><option value="file">Files</option></Select>
      <Select aria-label="Sort files" size="sm" width="auto" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Name</option><option value="newest">Newest</option></Select>
      <Select aria-label="File view" size="sm" width="auto" value={view} onChange={e => setView(e.target.value as 'grid' | 'list')}><option value="grid">Grid</option><option value="list">List</option></Select>
    </Flex>
    <Flex gap={2} wrap="wrap" marginBottom={3}>
      <Button size="xs" isDisabled={busy} onClick={() => { setCreating(!creating); setName(''); }}>New folder</Button>
      <Button size="xs" isDisabled={busy} onClick={() => picker.current?.click()}>Add files</Button>
      <Button size="xs" isDisabled={busy || !selected.size} onClick={() => copy('copy')}>Copy</Button>
      <Button size="xs" isDisabled={busy || !selected.size} onClick={() => copy('cut')}>Cut</Button>
      <Button size="xs" isDisabled={busy || !clipboard} onClick={() => paste()}>Paste{clipboard ? ` (${clipboard.items.length})` : ''}</Button>
      {location.deviceId && <Checkbox size="sm" isChecked={hidden} isDisabled={busy} onChange={e => setHidden(e.target.checked)}>Hidden</Checkbox>}
      <input hidden type="file" multiple ref={picker} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; void run(async signal => { for (const file of files) { if ((await list(location, signal, true, false)).some(item => filesystemName(item).toLowerCase() === file.name.toLowerCase())) throw new Error(`${file.name} already exists.`); await write(location, file, signal); } }); }} />
    </Flex>
    {creating && <Flex gap={2} marginBottom={3} as="form" onSubmit={e => { e.preventDefault(); void run(async signal => { await mkdir(location, name.trim(), signal); setCreating(false); }); }}><Input autoFocus size="sm" aria-label="New folder name" placeholder="Folder name" value={name} onChange={e => setName(e.target.value)} minWidth={0} /><Button type="submit" size="sm" isDisabled={busy || !name.trim()}>Create</Button></Flex>}
    {approval && <Box role="alert" border="1px solid var(--tt-border)" borderRadius="8px" padding={3} marginBottom={3}><Text fontSize="13px" overflowWrap="anywhere">{approval.prompt}</Text><Flex gap={2} marginTop={2}><Button size="sm" onClick={() => approval.decide(true)}>Approve once</Button><Button size="sm" onClick={() => approval.decide(false)}>Decline</Button></Flex></Box>}
    {error && <Text role="alert" fontSize="12px" color="var(--tt-danger, #b91c1c)" marginBottom={3} overflowWrap="anywhere">{error}</Text>}
    {(status || busy || loading) && <Box aria-live="polite" marginBottom={3}><Flex align="center" gap={2}><Text fontSize="12px" flex={1} overflowWrap="anywhere">{status || (loading ? 'Refreshing files…' : 'Working…')}</Text>{(busy || loading) && <Button size="xs" onClick={() => { operation.current?.abort(); setLoading(false); }}>Cancel</Button>}</Flex>{progress !== null && <Progress aria-label="File transfer progress" value={progress} size="xs" marginTop={2} />}</Box>}
    <Box maxHeight={compact ? '420px' : undefined} overflowY={compact ? 'auto' : undefined} minWidth={0}>
      {view === 'grid' ? <ThingsGridView items={visible} handlers={handlers} displayMode="name" /> : <ThingsListView items={visible} handlers={handlers} displayMode="name" onToggleAll={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map(item => item.id)))} allSelected={visible.length > 0 && visible.every(item => selected.has(item.id))} />}
      {!visible.length && !loading && <Text fontSize="13px" textAlign="center" padding={6} color="var(--tt-muted)">{query || kind !== 'all' ? 'No matching files or folders.' : 'No files or folders here yet.'}</Text>}
    </Box>
    <Text fontSize="11px" color="var(--tt-muted)" marginTop={3}>{visible.length} items{selected.size ? ` · ${selected.size} selected` : ''}{fileLimit === null ? '' : ` · Files up to ${formatAttachmentBytes(fileLimit)}`}</Text>
    {contextItem && <ThingContextMenu {...contextMenu.menuProps} zIndex={TRANSFER_MENU_Z + 2} model={handlers.itemMenuFor!(contextItem)} onAction={({ action: chosen }) => action(contextItem, chosen.command as ThingsItemAction)} />}
    {compact && <Modal isOpen={popup} onClose={() => setPopup(false)} size="3xl" scrollBehavior="inside"><ModalOverlay zIndex={TRANSFER_DIALOG_Z} /><ModalContent marginX={3} maxWidth="min(900px, calc(100vw - 24px))" containerProps={{ zIndex: TRANSFER_DIALOG_Z + 1 }}><ModalHeader>Browse files</ModalHeader><ModalCloseButton /><ModalBody paddingBottom={5}>{popup && <FilesystemThingsBrowser deviceId={location.deviceId} initialPath={location.deviceId ? location.path : ''} initialFolderId={location.folderId} />}</ModalBody></ModalContent></Modal>}
  </Box>;
};

export const FilesystemThingsPage = () => {
  const [params] = useSearchParams(), navigate = useNavigate();
  const deviceId = params.get('files') === 'thingtime' ? undefined : params.get('files') || undefined;
  return <Flex justify="center" minHeight="100vh" width="100%" background="var(--tt-surface, #fafafb)" paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))" paddingBottom={12}><Box width="100%" maxWidth="1100px" padding={{ base: 3, md: 6 }} minWidth={0}><FilesystemThingsBrowser deviceId={deviceId} initialPath={params.get('path') || ''} initialFolderId={params.get('folder')} onLocationChange={location => navigate(`/things?files=${encodeURIComponent(location.deviceId || 'thingtime')}${location.deviceId && location.path ? `&path=${encodeURIComponent(location.path)}` : !location.deviceId && location.folderId ? `&folder=${encodeURIComponent(location.folderId)}` : ''}`, { replace: true })} /></Box></Flex>;
};
