import { cloudFilesystemDownloadHref, isCloudFilesystemFile, isFilesystemItem, createSyncDestinationLookup, publishFilesystemUpload, readCloudFilesystemFile, relocateCloudFilesystemFile } from './filesystemCloudFile';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { CLOUD_FILE_REQUIREMENTS, validFileName } from '~/fileSync/cloudFile';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Checkbox, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Progress, Select, Spinner, Text } from '@chakra-ui/react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { EXPECTED_DATA_PLANE_HEADER } from '~/utils/dataPlane';
import { useAttachmentUploads } from '../Attachments/useAttachmentUploads';
import { formatAttachmentBytes } from '../Attachments/attachmentUiCore';
import { FILESYSTEM_MAX_BYTES, filesystemPath } from '~/api/utils/devices/deviceFilesystemCore';
import { browseClickIntent } from './browseInteraction';
import { ThingsGridView, ThingsListView, type ThingsItemAction, type ThingsItemHandlers } from './ThingsViews';
import { isFolder, thingDisplayName, type ThingsThing } from './thingsCore';
import { fileRequest, filesystemClipboard, remoteEntryThing, remoteFileCommand, readRemoteFile, writeRemoteFile, requireFilesystemCapabilities, type FileApproval, type FileLocation } from './filesystemClient';
import { filesystemName, itemLocation, transferFilesystem } from './filesystemTransfer';
import { bundleFromPlan } from '~/utils/thingTransfer/browser';
import { PersistedThingContextMenu as ThingContextMenu } from '../Thingtime/ContextMenu/PersistedThingContextMenu';
import { useThingContextMenu } from '../Thingtime/ContextMenu/useThingContextMenu';
import { thingStorageHref } from './thingStorageNavigation';
import { THING_ACTIONS } from '~/schemas/thingActions';
import { useThingPathPins } from './useThingPathPins';
import { movePin, orderPinned, pinPathKey, thingPinPath } from './thingPathPins';
import { buildThingEntityMenu } from '../Thingtime/ContextMenu/thingEntityMenu';
import { TRANSFER_DIALOG_Z, TRANSFER_MENU_Z } from './transferLayers';

const listings = new Map<string, ThingsThing[]>();
const locationKey = (owner: string, dataPlane: string | null, location: FileLocation) => JSON.stringify([typeof window === 'undefined' ? '' : window.location.origin, owner, dataPlane, location]);
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
  const user = useCurrentUser();
  const dataPlane = useDataPlane();
  return <FilesystemThingsContent key={JSON.stringify([user?.id, dataPlane])} {...props} />;
};

const FilesystemThingsContent = ({ deviceId, initialPath = '', initialFolderId = null, compact = false, onLocationChange }: Props) => {
  const user = useCurrentUser();
  const dataPlane = useDataPlane();
  const ownerId = user?.id || '';
  const api = useApi(), apiRef = useRef(api); apiRef.current = api;
  const navigate = useNavigate();
  const canManageStorage = (item: ThingsThing) => !user?.temporary && item.author?.id === ownerId &&
    !item.inode && (isCloudFilesystemFile(item) || isFolder(item) || item.thingtime.includes('attachment'));
  const [location, setLocation] = useState<FileLocation>(() => deviceId ? { deviceId, path: initialPath } : { folderId: initialFolderId });
  useEffect(() => {
    setLocation(current => (current.deviceId === deviceId && (deviceId ? current.path === initialPath : current.folderId === initialFolderId)) ? current : (deviceId ? { deviceId, path: initialPath } : { folderId: initialFolderId }));
  }, [deviceId, initialPath, initialFolderId]);
  const [pinAncestors, setPinAncestors] = useState<{ owner: string; folder: string | null; ids: string[] } | null>(null);
  const [pinPathError, setPinPathError] = useState('');
  const [pinPathRetry, setPinPathRetry] = useState(0);
  const folder = location.folderId || null;
  useEffect(() => {
    const controller = new AbortController();
    setPinPathError('');
    if (location.deviceId || !ownerId || !dataPlane) return () => controller.abort();
    if (!folder) { setPinAncestors({ owner: ownerId, folder, ids: [] }); return () => controller.abort(); }
    void (async () => {
      const ids: string[] = [], seen = new Set<string>();
      let id: string | null = folder;
      while (id) {
        if (seen.has(id)) throw Error('The folder path contains a cycle.');
        seen.add(id);
        const result = await apiRef.current.v1.things.get({ id }, { signal: controller.signal, expectedActor: ownerId, expectedDataPlane: dataPlane });
        controller.signal.throwIfAborted();
        const thing = result.thing;
        if (!thing || !isFolder(thing)) throw Error('The pin location could not be verified.');
        ids.unshift(id); id = thing.folderId || null;
      }
      setPinAncestors({ owner: ownerId, folder, ids });
    })().catch(cause => { if (!controller.signal.aborted) setPinPathError(failure(cause)); });
    return () => controller.abort();
  }, [ownerId, dataPlane, folder, location.deviceId, pinPathRetry]);
  const pinPathReady = pinAncestors?.owner === ownerId && pinAncestors.folder === folder;
  const pinPath = useMemo(() => thingPinPath(compact ? '/things/files/panel' : '/things/files', pinPathReady ? pinAncestors.ids : []), [compact, pinPathReady, pinAncestors]);
  const pinKey = pinPathKey(pinPath);
  const pins = useThingPathPins([pinPath], !location.deviceId && !!ownerId && !user?.temporary && pinPathReady);
  const pinState = pins.state(pinPath);
  const [reorderingPath, setReorderingPath] = useState<string | null>(null);
  const reordering = pins.enabled && reorderingPath === pinKey;
  const savePin = (intent: Parameters<typeof pins.mutate>[1]) => { void pins.mutate(pinPath, intent).catch(() => {}); };
  const [history, setHistory] = useState<FileLocation[]>([]);
  const [items, setItems] = useState<ThingsThing[]>(() => listings.get(locationKey(ownerId, dataPlane, location)) || []);
  const [devices, setDevices] = useState<Array<{ id: string; name: string; capabilities: string[] }>>([]);
  const [view, setView] = useState<'grid' | 'list'>(compact ? 'list' : 'grid');
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [sort, setSort] = useState('name');
  const [hidden, setHidden] = useState(false), [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState(() => filesystemClipboard.get(ownerId));
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number | null>(null), [name, setName] = useState(''), [creating, setCreating] = useState(false);
  const [approval, setApproval] = useState<{ id: string; prompt: string; decide: (yes: boolean) => void } | null>(null);
  const [popup, setPopup] = useState(false);
  const contextMenu = useThingContextMenu();
  const [contextItem, setContextItem] = useState<ThingsThing | null>(null);
  const active = useRef(false);
  const operation = useRef<AbortController | null>(null), picker = useRef<HTMLInputElement>(null), mounted = useRef(true);
  const uploadWaiter = useRef<{ file: File; resolve: (id: string) => void; reject: (e: Error) => void } | null>(null);
  const uploadError = useCallback((message: string) => { uploadWaiter.current?.reject(new Error(message)); uploadWaiter.current = null; }, []);
  const uploads = useAttachmentUploads(ownerId, uploadError, uploadError, true, undefined, {
    purpose: 'file', selectionScope: 'transfer', maxFiles: 1,
    remainingBytes: user?.storage?.remainingBytes, storageStatus: user?.storage?.status
  });
  useEffect(() => {
    const pending = uploadWaiter.current;
    if (!pending) return;
    const upload = uploads.uploads.find(item => item.sourceFile === pending.file);
    if (upload?.status === 'ready' && upload.attachment) {
      uploads.markCommitted([upload.attachment.id]); uploadWaiter.current = null; pending.resolve(upload.attachment.id);
    } else if (upload?.status === 'error') uploadError(upload.error || 'Upload failed.');
    else if (upload) setProgress(upload.progress);
  }, [uploads.uploads, uploads.markCommitted, uploadError]);
  useEffect(() => {
    mounted.current = true;
    const update = () => setClipboard(filesystemClipboard.get(ownerId));
    update(); window.addEventListener('thingtime-files-clipboard', update);
    return () => { mounted.current = false; operation.current?.abort(); uploadError('Transfer cancelled; source files were kept.'); window.removeEventListener('thingtime-files-clipboard', update); };
  }, [ownerId, uploadError]);
  useEffect(() => {
    if (!ownerId) return;
    const controller = new AbortController();
    void requireFilesystemCapabilities().then(() => fileRequest('/api/v1/devices', undefined, controller.signal)).then(result => setDevices(result.devices || [])).catch(() => {});
    return () => controller.abort();
  }, [ownerId]);
  const approve: FileApproval = useCallback((request, signal) => new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { setApproval(null); reject(new DOMException('Cancelled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    setApproval({ ...request, decide: async yes => {
      setApproval(null); signal.removeEventListener('abort', abort);
      try {
        await fileRequest('/api/v1/devices/approvals', { approvalId: request.id, decision: yes ? 'approved' : 'denied' }, signal);
        if (yes) resolve(); else reject(new Error('Device action declined.'));
      } catch (e) { reject(e); }
    } });
  }), []);
  const list = useCallback(async (target: FileLocation, signal: AbortSignal, includeHidden = hidden) => {
    await requireFilesystemCapabilities(); signal.throwIfAborted();
    const result: ThingsThing[] = [];
    if (target.deviceId) {
      let cursor: number | undefined;
      const seen = new Set<number>();
      do {
        const page = await remoteFileCommand(target.deviceId, { op: 'list', path: target.path, hidden: includeHidden, ...(cursor === undefined ? {} : { cursor }) }, signal, approve);
        result.push(...page.entries!.map(entry => remoteEntryThing(target.deviceId, entry)));
        cursor = page.nextCursor ?? undefined;
        if (cursor !== undefined && seen.has(cursor)) throw new Error('The directory repeated a page. Refresh to retry.');
        if (cursor !== undefined) seen.add(cursor);
      } while (cursor !== undefined);
    } else {
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        if (!dataPlane) throw Error('The database selection is unavailable. Refresh to retry.');
        const page = await fileRequest(`/api/v1/things?folder=${encodeURIComponent(target.folderId || 'root')}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, signal, undefined, {
          [EXPECTED_DATA_PLANE_HEADER]: dataPlane, 'X-Thingtime-Expected-Actor': ownerId
        });
        result.push(...page.things); cursor = page.nextCursor || undefined;
        if (cursor && seen.has(cursor)) throw new Error('The folder repeated a page. Refresh to retry.');
        if (cursor) seen.add(cursor);
      } while (cursor);
    }
    return result;
  }, [approve, hidden, dataPlane, ownerId]);
  const refresh = useCallback(async (signal: AbortSignal) => {
    const fresh = await list(location, signal);
    signal.throwIfAborted();
    const key = locationKey(ownerId, dataPlane, location);
    listings.delete(key); listings.set(key, fresh);
    while (listings.size > 12) listings.delete(listings.keys().next().value!);
    setItems(fresh);
  }, [list, location, ownerId, dataPlane]);
  useEffect(() => {
    if (!ownerId) return;
    const controller = new AbortController();
    operation.current = controller; setItems(listings.get(locationKey(ownerId, dataPlane, location)) || []); setSelected(new Set()); setLoading(true); setError('');
    void refresh(controller.signal).catch(e => { if (!controller.signal.aborted) setError(failure(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh, ownerId, dataPlane, location]);
  const go = (next: FileLocation, back = false) => {
    if (busy) return;
    if (!back) setHistory(current => [...current, location]);
    setQuery(''); contextMenu.closeMenu(); setLocation(next); onLocationChange?.(next);
  };
  const run = async (work: (signal: AbortSignal) => Promise<void>, completion = 'Done') => {
    if (active.current) return false;
    active.current = true;
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setLoading(false); setError(''); setStatus(''); setProgress(null);
    try { await requireFilesystemCapabilities(); await work(controller.signal); controller.signal.throwIfAborted(); await refresh(controller.signal); setStatus(completion); return true; }
    catch (e) { if (mounted.current) { setStatus(''); setError(controller.signal.aborted ? 'Stopped waiting. An accepted device action or upload may still finish. Refresh before retrying; source files were kept unless their completed move was already confirmed.' : failure(e)); } return false; }
    finally { active.current = false; if (mounted.current) { setBusy(false); setProgress(null); } }
  };
  const progressFor = (filename: string) => (done: number, total: number) => { setStatus(filename); setProgress(total ? done / total * 100 : 100); };
  const read = async (item: ThingsThing, signal: AbortSignal) => {
    if (item.inode) return readRemoteFile(item.inode.deviceId, item.inode, signal, approve, progressFor(filesystemName(item)));
    if (isCloudFilesystemFile(item)) return readCloudFilesystemFile(item, ownerId, signal);
    if (!item.thingtime.includes('attachment')) throw new Error('Select a file.');
    const size = Number(item.crystal.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > FILESYSTEM_MAX_BYTES) throw new Error('Choose a file up to 32 MiB.');
    const bundle = await bundleFromPlan({ roots: [item.id], things: [{ id: item.id, thingtime: ['attachment'], crystal: { recordingFileId: 'bytes', filePurpose: 'file' } }], files: [{ id: 'bytes', sourceId: item.id, targetId: item.id, name: filesystemName(item), mime: String(item.crystal.contentType || 'application/octet-stream'), bytes: size }] }, { signal });
    return new File([Uint8Array.from(bundle.files.get('bytes')!)], filesystemName(item), { type: String(item.crystal.contentType || 'application/octet-stream') });
  };
  const bulk = async (op: string, chosen: ThingsThing[], target: FileLocation, signal: AbortSignal) => {
    if (target.deviceId) throw new Error('Choose a Thingtime folder.');
    const result = await fileRequest('/api/v1/things/bulk', { op, ids: chosen.map(item => item.id), folderId: target.folderId }, signal);
    if (result.failed || result.results?.some((entry: any) => !entry.ok)) throw new Error(result.results?.find((entry: any) => !entry.ok)?.error || 'Some items could not be moved. Refresh to inspect the completed items.');
  };
  const mkdir = async (target: FileLocation, folderName: string, signal: AbortSignal): Promise<FileLocation> => {
    if (!filesystemPath(folderName) || !folderName || folderName.includes('/')) throw new Error('Choose a folder name without slashes.');
    if (target.deviceId) {
      const path = join(target.path, folderName); await remoteFileCommand(target.deviceId, { op: 'mkdir', path }, signal, approve); return { deviceId: target.deviceId, path };
    }
    const result = await fileRequest('/api/v1/things', { thingtime: ['folder'], crystal: { name: folderName }, folderId: target.folderId, acl: ['tt:user'] }, signal);
    return { folderId: result.thing?.id || result.id };
  };
  const write = async (target: FileLocation, file: File, signal: AbortSignal, isSyncDestination: ReturnType<typeof createSyncDestinationLookup>) => {
    setStatus(`Saving ${file.name}`);
    if (target.deviceId) return writeRemoteFile(target.deviceId, join(target.path, file.name), file, signal, approve, progressFor(file.name));
    if (file.size === 0) {
      await requireThingtimeCapability('api.attachment-uploads', '1.6.2');
      await requireThingtimeCapability('api.attachment-upload-complete', '1.5.0');
    }
    const syncFolderId = target.folderId && await isSyncDestination(target.folderId) ? target.folderId : null;
    if (syncFolderId) {
      if (!validFileName(file.name)) throw Error('Choose a filename that can be used in a sync folder.');
      await requireThingtimeCapability('api.files', '1.9.0');
      await requireThingtimeCapability('api.attachment-content', file.size === 0 ? '1.16.0' : CLOUD_FILE_REQUIREMENTS['api.attachment-content']);
    }
    const id = await new Promise<string>((resolve, reject) => {
      signal.throwIfAborted();
      const abort = () => { uploadError('Transfer cancelled; the source was kept.'); };
      signal.addEventListener('abort', abort, { once: true });
      uploadWaiter.current = { file, resolve: value => { signal.removeEventListener('abort', abort); resolve(value); }, reject: e => { signal.removeEventListener('abort', abort); reject(e); } };
      uploads.replaceFiles([file], signal);
    });
    signal.throwIfAborted();
    if (syncFolderId) {
      setStatus(`Publishing ${file.name}`);
      try { await publishFilesystemUpload(ownerId, id, file.name, syncFolderId, signal); }
      catch (e) { throw Error(`Could not confirm ${file.name} in this folder. Refresh before retrying. The upload is retained: ${failure(e)}`); }
    } else if (target.folderId) {
      try { await bulk('move', [{ id } as ThingsThing], target, signal); }
      catch (e) { throw new Error(`Saved ${file.name} in Thingtime root, but could not place it in this folder: ${failure(e)}`); }
    }
  };
  const copy = (mode: 'copy' | 'cut', chosen = items.filter(item => selected.has(item.id))) => {
    if (!chosen.length || busy) return;
    filesystemClipboard.set({ ownerId, mode, location, items: chosen }); setStatus(`${chosen.length} selected for ${mode === 'copy' ? 'copy' : 'move'}. Choose a destination and paste.`);
  };
  const paste = (target = location) => {
    const source = filesystemClipboard.get(ownerId);
    if (!source) return;
    void run(async signal => {
      const isSyncDestination = createSyncDestinationLookup(ownerId, signal);
      await transferFilesystem(source, target, {
        list: where => list(where, signal, true), check: () => signal.throwIfAborted(),
        mkdir: (where, title) => mkdir(where, title, signal), read: item => read(item, signal), write: (where, file) => write(where, file, signal, isSyncDestination),
        remove: async item => {
          if (item.inode) await remoteFileCommand(item.inode.deviceId, { op: 'trash', path: item.inode.path, version: item.inode.version }, signal, approve);
          else if (isFolder(item)) await fileRequest('/api/v1/things', { id: item.id }, signal, 'DELETE');
          else if (isCloudFilesystemFile(item)) await relocateCloudFilesystemFile(item, ownerId, item.folderId, true, signal);
          else await fileRequest('/api/v1/attachments/delete', { id: item.id }, signal);
        },
        nativeMove: async (chosen, where) => {
          if (where.deviceId) for (const item of chosen) {
            if (!item.inode) throw new Error('Select files on the source device.');
            await remoteFileCommand(where.deviceId, { op: 'move', path: item.inode.path, version: item.inode.version, destination: join(where.path, item.inode.name) }, signal, approve);
          } else {
            const cloudFiles = chosen.filter(isCloudFilesystemFile);
            if (cloudFiles.length) {
              const destinationNames = new Set((await list(where, signal, true)).map(entry => filesystemName(entry).normalize('NFC').toLowerCase()));
              for (const item of cloudFiles) {
                if (item.folderId === where.folderId) continue;
                const name = filesystemName(item).normalize('NFC').toLowerCase();
                if (destinationNames.has(name)) throw Error(`${filesystemName(item)} already exists. Choose another folder.`);
                destinationNames.add(name);
              }
              for (const item of cloudFiles) {
                if (item.folderId !== where.folderId) await relocateCloudFilesystemFile(item, ownerId, where.folderId, false, signal);
              }
            }
            const ordinary = chosen.filter(item => !isCloudFilesystemFile(item));
            if (ordinary.length) await bulk('move', ordinary, where, signal);
          }
        }
      });
      if (source.mode === 'cut') filesystemClipboard.set(null);
    });
  };
  const open = (item: ThingsThing) => {
    if (isFolder(item)) go(itemLocation(item));
    else if (isCloudFilesystemFile(item)) void run(async signal => {
      const href = await cloudFilesystemDownloadHref(item, ownerId, signal);
      signal.throwIfAborted();
      const download = document.createElement('a');
      download.href = href;
      download.download = filesystemName(item);
      download.click();
    }, 'Download requested');
    else void run(async signal => saveFile(await read(item, signal)));
  };
  const action = (item: ThingsThing, verb: ThingsItemAction) => {
    const chosen = selected.has(item.id) ? items.filter(entry => selected.has(entry.id)) : [item];
    if ((verb === 'pin' || verb === 'unpin') && pins.enabled && !item.inode) { for (const entry of chosen) if (!entry.inode) savePin({ operation: verb, thingId: entry.id }); }
    else if (verb === 'reorder-pins' && pins.enabled) setReorderingPath(pinKey);
    else if (verb === 'copy' || verb === 'cut') copy(verb, chosen);
    else if (verb === 'paste-into') paste(itemLocation(item));
    else if (verb === 'open' || verb === 'download') open(item);
    else if (verb === 'storage-placement' && canManageStorage(item)) navigate(thingStorageHref(item.id, { dataPlane: 'home', fromThings: true }));
  };
  const visible = useMemo(() => orderPinned(items.filter(item => isFilesystemItem(item) &&
    filesystemName(item).toLowerCase().includes(query.toLowerCase()) && (kind === 'all' || (kind === 'folder') === isFolder(item)))
    .sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || (sort === 'newest' ? Date.parse(b.updatedAt) - Date.parse(a.updatedAt) : filesystemName(a).localeCompare(filesystemName(b)))), pins.enabled ? pinState.ids : [], item => item.id), [items, query, kind, sort, pins.enabled, pinState.ids]);
  const visiblePinIds = pinState.ids.filter(id => visible.some(item => item.id === id));
  const handlers: ThingsItemHandlers = {
    compact: true, menuZIndex: TRANSFER_MENU_Z + 2,
    pinControlFor: item => !pins.enabled || item.inode ? undefined : {
      id: item.id, label: thingDisplayName(item), pinned: pinState.ids.includes(item.id), reordering,
      index: visiblePinIds.indexOf(item.id), count: visiblePinIds.length,
      moveBy: offset => {
        const index = visiblePinIds.indexOf(item.id), to = Math.max(0, Math.min(visiblePinIds.length - 1, index + offset));
        const ids = [...visiblePinIds]; ids.splice(index, 1); ids.splice(to, 0, item.id); savePin({ operation: 'reorder', thingIds: ids });
      },
      moveBefore: (target, after) => {
        const remaining = visiblePinIds.filter(id => id !== item.id);
        const before = after ? remaining[remaining.indexOf(target) + 1] || null : target;
        savePin({ operation: 'reorder', thingIds: movePin(visiblePinIds, item.id, before) });
      }
    },
    itemHref: item => item.inode ? `/things?files=${encodeURIComponent(item.inode.deviceId)}&path=${encodeURIComponent(isFolder(item) ? item.inode.path : location.path || '')}` : `/things?files=thingtime${isFolder(item) ? `&folder=${encodeURIComponent(item.id)}` : location.folderId ? `&folder=${encodeURIComponent(location.folderId)}` : ''}`,
    ownerId, selected, cutIds: new Set(clipboard?.mode === 'cut' ? clipboard.items.map(item => item.id) : []), isMobile: true,
    onItemClick: (item, event) => {
      if (browseClickIntent(event) === 'select') setSelected(current => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; });
      else if (browseClickIntent(event) === 'open') open(item);
    },
    onItemOpen: open, onItemToggle: item => setSelected(current => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; }),
    onItemAction: action, onItemContextMenu: (item, event) => { setContextItem(item); contextMenu.openAtPointer(event); },
    onItemDragStart: (_item, event) => event.preventDefault(), onItemDragEnd: () => {}, dropTargetId: undefined,
    onFolderDragOver: () => {}, onFolderDragLeave: () => {}, onFolderDrop: () => {},
    itemMenuFor: item => buildThingEntityMenu(pins.enabled && !item.inode ? {
      [pinState.ids.includes(item.id) ? 'unpin' : 'pin']: true,
      'reorder-pins': { disabled: !pinState.ids.length, selected: reordering }
    } : {}, [{ id: 'files', actions: [
      { id: 'open', command: 'open', label: isFolder(item) ? 'Open folder' : 'Download', icon: isFolder(item) ? '📁' : '📥', disabled: busy || (!!item.inode && !['folder', 'file'].includes(item.inode.type)) },
      ...(canManageStorage(item) ? [{ ...THING_ACTIONS['storage-placement'],
        href: thingStorageHref(item.id, { dataPlane: 'home', fromThings: true }), disabled: busy }] : []),
      { id: 'copy', command: 'copy', label: 'Copy', icon: '📋', disabled: busy },
      { id: 'cut', command: 'cut', label: 'Cut to move', icon: '✂️', disabled: busy },
      ...(isFolder(item) ? [{ id: 'paste-into', command: 'paste-into', label: 'Paste into folder', icon: '📥', disabled: busy || !clipboard }] : [])
    ] }], item.inode ? undefined : item.id)
  };
  if (!ownerId) return <Text padding={4}>Sign in to browse your files and paired devices.</Text>;
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
        <option value="thingtime">Your Thingtime</option>
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
      <Button size="xs" isDisabled={busy} onClick={() => picker.current?.click()}>Upload</Button>
      <Button size="xs" isDisabled={busy || !selected.size} onClick={() => copy('copy')}>Copy</Button>
      <Button size="xs" isDisabled={busy || !selected.size} onClick={() => copy('cut')}>Cut</Button>
      <Button size="xs" isDisabled={busy || !clipboard} onClick={() => paste()}>Paste{clipboard ? ` (${clipboard.items.length})` : ''}</Button>
      {location.deviceId && <Checkbox size="sm" isChecked={hidden} isDisabled={busy} onChange={e => setHidden(e.target.checked)}>Hidden</Checkbox>}
      <input hidden type="file" multiple ref={picker} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; void run(async signal => { const isSyncDestination = createSyncDestinationLookup(ownerId, signal); for (const file of files) { if ((await list(location, signal, true)).some(item => filesystemName(item).toLowerCase() === file.name.toLowerCase())) throw new Error(`${file.name} already exists.`); await write(location, file, signal, isSyncDestination); } }); }} />
    </Flex>
    {creating && <Flex gap={2} marginBottom={3} as="form" onSubmit={e => { e.preventDefault(); void run(async signal => { await mkdir(location, name.trim(), signal); setCreating(false); }); }}><Input autoFocus size="sm" aria-label="New folder name" placeholder="Folder name" value={name} onChange={e => setName(e.target.value)} minWidth={0} /><Button type="submit" size="sm" isDisabled={busy || !name.trim()}>Create</Button></Flex>}
    {approval && <Box role="alert" border="1px solid var(--tt-border)" borderRadius="8px" padding={3} marginBottom={3}><Text fontSize="13px" overflowWrap="anywhere">{approval.prompt}</Text><Flex gap={2} marginTop={2}><Button size="sm" onClick={() => approval.decide(true)}>Approve once</Button><Button size="sm" onClick={() => approval.decide(false)}>Decline</Button></Flex></Box>}
    {error && <Text role="alert" fontSize="12px" color="var(--tt-danger, #b91c1c)" marginBottom={3} overflowWrap="anywhere">{error}</Text>}
    {(status || busy || loading) && <Box aria-live="polite" marginBottom={3}><Flex align="center" gap={2}><Text fontSize="12px" flex={1} overflowWrap="anywhere">{status || (loading ? 'Refreshing files…' : 'Working…')}</Text>{(busy || loading) && <Button size="xs" onClick={() => { operation.current?.abort(); setLoading(false); }}>Cancel</Button>}</Flex>{progress !== null && <Progress aria-label="File transfer progress" value={progress} size="xs" marginTop={2} />}</Box>}
    {pinPathError && <Flex gap={2} align="center" wrap="wrap" marginBottom={2}><Text role="alert" fontSize="12px">{pinPathError}</Text><Button size="sm" onClick={() => setPinPathRetry(value => value + 1)}>Retry pin location</Button></Flex>}
    {pins.enabled && <Flex align="center" gap={2} wrap="wrap" marginBottom={2}>
      <Button size="sm" variant="ghost" isDisabled={!pinState.ids.length && !reordering} onClick={() => setReorderingPath(reordering ? null : pinKey)}>{reordering ? 'Done' : 'Reorder pins'}</Button>
      {pinState.busy && <Spinner size="xs" aria-label="Saving pins" />}
      {pinState.error && <><Text role="alert" fontSize="12px" color="var(--tt-danger, #b91c1c)">{pinState.error}</Text><Button size="sm" onClick={() => { void pins.retry(pinPath).catch(() => {}); }}>Retry pins</Button></>}
    </Flex>}
    <Box data-pin-surface={pinKey} onContextMenu={event => { if (!pins.enabled || event.defaultPrevented || (event.target as HTMLElement).closest('[data-thing-id]')) return; setContextItem(null); contextMenu.openAtPointer(event); }} maxHeight={compact ? '420px' : undefined} overflowY={compact ? 'auto' : undefined} minWidth={0}>
      {view === 'grid' ? <ThingsGridView items={visible} handlers={handlers} displayMode="name" /> : <ThingsListView items={visible} handlers={handlers} displayMode="name" onToggleAll={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map(item => item.id)))} allSelected={visible.length > 0 && visible.every(item => selected.has(item.id))} />}
      {!visible.length && !loading && <Text fontSize="13px" textAlign="center" padding={6} color="var(--tt-muted)">{query || kind !== 'all' ? 'No matching files or folders.' : 'No files or folders here yet.'}</Text>}
    </Box>
    <Text fontSize="11px" color="var(--tt-muted)" marginTop={3}>{visible.length} items{selected.size ? ` · ${selected.size} selected` : ''} · Clipboard and device transfers up to {formatAttachmentBytes(FILESYSTEM_MAX_BYTES)} per file</Text>
    <ThingContextMenu {...contextMenu.menuProps} zIndex={TRANSFER_MENU_Z + 2}
      model={contextItem ? handlers.itemMenuFor!(contextItem) : buildThingEntityMenu(pins.enabled ? { 'reorder-pins': { disabled: !pinState.ids.length, selected: reordering } } : {})}
      onAction={({ action: chosen }) => { if (contextItem) action(contextItem, chosen.command as ThingsItemAction); else if (chosen.command === 'reorder-pins') setReorderingPath(pinKey); }} />
    {compact && <Modal isOpen={popup} onClose={() => setPopup(false)} size="3xl" scrollBehavior="inside"><ModalOverlay zIndex={TRANSFER_DIALOG_Z} /><ModalContent marginX={3} maxWidth="min(900px, calc(100vw - 24px))" containerProps={{ zIndex: TRANSFER_DIALOG_Z + 1 }}><ModalHeader>Browse files</ModalHeader><ModalCloseButton /><ModalBody paddingBottom={5}>{popup && <FilesystemThingsBrowser deviceId={location.deviceId} initialPath={location.deviceId ? location.path : ''} initialFolderId={location.folderId} />}</ModalBody></ModalContent></Modal>}
  </Box>;
};

export const FilesystemThingsPage = () => {
  const [params] = useSearchParams(), navigate = useNavigate();
  const deviceId = params.get('files') === 'thingtime' ? undefined : params.get('files') || undefined;
  return <Flex justify="center" minHeight="100vh" width="100%" background="var(--tt-surface, #fafafb)" paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))" paddingBottom={12}><Box width="100%" maxWidth="1100px" padding={{ base: 3, md: 6 }} minWidth={0}><FilesystemThingsBrowser deviceId={deviceId} initialPath={params.get('path') || ''} initialFolderId={params.get('folder')} onLocationChange={location => navigate(`/things?files=${encodeURIComponent(location.deviceId || 'thingtime')}${location.deviceId && location.path ? `&path=${encodeURIComponent(location.path)}` : !location.deviceId && location.folderId ? `&folder=${encodeURIComponent(location.folderId)}` : ''}`, { replace: true })} /></Box></Flex>;
};
