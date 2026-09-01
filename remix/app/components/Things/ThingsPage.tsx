import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Box, Button, Flex, Input, Menu, MenuButton, MenuItem, MenuList, Portal, Text } from '@chakra-ui/react';
import { ArrowUpDown, Columns3, Eye, LayoutGrid, Layers, Plus, Rows3, Search as SearchIcon, Tag, X } from 'lucide-react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { useIsMobileViewport } from '~/components/Nav/Drawer/useDrawer';
import { Rainbow } from '~/components/Rainbow/Rainbow';
import { DeviceDetailsDrawer } from '~/components/Devices/DeviceDetailsDrawer';
import { LocalNodeSetupCard } from '~/components/Devices/LocalNodeSetupCard';
import type { DeviceActionIntent, DeviceControlResolver } from '~/components/Devices/DeviceStateGrid';
import type { DeviceActionKind, DeviceRuntimeState } from '~/components/Devices/deviceTypes';
import { useDeviceStore } from '~/components/Devices/useDeviceStore';
import { useLocalThingtimeNode } from '~/components/Devices/useLocalThingtimeNode';
import { ThingContextMenu } from '~/components/Thingtime/ContextMenu/ThingContextMenu';
import type { ThingContextMenuAction } from '~/components/Thingtime/ContextMenu/ThingContextMenu';
import { useThingContextMenu } from '~/components/Thingtime/ContextMenu/useThingContextMenu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { RAINBOW_TEXT } from '~/theme/rainbow';

import { FolderTree } from './FolderTree';
import { DeleteConfirmDialog, MoveDialog, NewFolderDialog, PreviewModal, RenameDialog, ShareDialog } from './ThingsDialogs';
import { ThingsColumnsView, ThingsGridView, ThingsListView } from './ThingsViews';
import type { ThingsItemAction, ThingsItemHandlers } from './ThingsViews';
import { buildThingsBackgroundMenu, buildThingsItemMenu } from './thingsMenuModel';
import {
  THINGS_GROUP_OPTIONS,
  THINGS_KIND_FILTERS,
  THINGS_SORT_OPTIONS,
  folderKeyOf,
  groupThings,
  isFolder,
  primaryKindOf,
  schemaIdOf,
  sortThings,
  thingDisplayName,
  thingLink,
  thingsCacheKey
} from './thingsCore';
import type {
	ThingsCache,
	ThingsClipboard,
	ThingsDisplayMode,
	ThingsGroupBy,
	ThingsKindFilter,
	ThingsSort,
	ThingsThing,
	ThingsView
} from './thingsCore';

const PAGE_SIZE = 50;
// listing noise: reaction/save/vote things are mechanical children, not content
const HIDDEN_KINDS = new Set(['reaction', 'save', 'vote']);
// custom sort/group loads the whole folder (honest ordering needs the full
// set) — bounded so a giant folder can't fetch forever
const MAX_ARRANGE_THINGS = 1000;
// schema render templates cached for Previews (bounded localCache footprint)
const MAX_CACHED_SCHEMA_RENDERS = 40;

const LOCAL_DEVICE_ACTIONS = new Set<DeviceActionKind>([
	'register-service',
	'unregister-service',
	'begin-pairing',
	'complete-pairing',
	'unpair',
	'request-permission',
	'open-permission-settings'
]);

const pillProps = (active: boolean) =>
  ({
    background: active ? 'var(--tt-accent-soft, rgba(244, 114, 182, 0.12))' : 'transparent',
    border: '1px solid',
    borderColor: active ? 'var(--tt-accent, #f472b6)' : 'var(--tt-border, #ececef)',
    borderRadius: '999px',
    color: 'var(--tt-text, #26262b)',
    fontSize: '12px',
    fontWeight: 500,
    height: 'auto',
    minHeight: '26px',
    minWidth: 'auto',
    padding: 'var(--tt-things-badge-padding, 3px 8px)',
    variant: 'outline' as const,
    _hover: {
      background: active ? 'var(--tt-accent-soft, rgba(244, 114, 182, 0.18))' : 'var(--tt-surface-hover, #f5f5f7)'
    }
	} as const);

const monoLabel = {
  color: 'var(--tt-faint, #b6b6c0)',
  fontFamily: 'var(--tt-font-mono, monospace)',
  fontSize: '10px',
  textTransform: 'uppercase'
} as const;

const ToolbarGroup = ({ children, label, wrap = false }: { children: React.ReactNode; label: string; wrap?: boolean }) => (
  <Flex alignItems="center" flexShrink={0} gap={2} maxWidth="100%" width="max-content" wrap={wrap ? 'wrap' : 'nowrap'}>
    <Text {...monoLabel}>{label}</Text>
    {children}
  </Flex>
);

const dedupeById = (things: ThingsThing[]): ThingsThing[] => {
  const seen = new Set<string>();
  return things.filter((thing) => {
    if (seen.has(thing.id)) return false;
    seen.add(thing.id);
    return true;
  });
};

export const ThingsPage = () => {
  const user = useCurrentUser();
  const api = useApi();
  const lopu = useLopu();
  const navigate = useNavigate();
  const isMobile = useIsMobileViewport();
  const [searchParams, setSearchParams] = useSearchParams();

  const apiRef = useRef(api);
  apiRef.current = api;
  const lopuRef = useRef(lopu);
  lopuRef.current = lopu;

  const folderId = searchParams.get('folder') || null;
  const previewParam = searchParams.get('preview') || null;
	const deviceParam = searchParams.get('device') || null;
  const currentKey = folderKeyOf(folderId);

	const devicesEnabled = Boolean(user && user.accountKind === 'user' && !user.temporary);
	const deviceStore = useDeviceStore({
		userId: user?.id,
		selectedDeviceId: deviceParam,
		enabled: devicesEnabled
	});
	const currentAccountDeviceIds = useMemo(
		() => deviceStore.devices.flatMap((device) => (device.summary?.id ? [device.summary.id] : [])),
		[deviceStore.devices]
	);
	const localNode = useLocalThingtimeNode(deviceParam, deviceStore.refreshList, deviceStore.loading ? undefined : currentAccountDeviceIds);
	const serverDeviceControlFor = deviceStore.controlFor;
	const executeServerDeviceAction = deviceStore.executeAction;
	const setDevicePermissionMode = deviceStore.setPermissionMode;
	const localDeviceControlFor = localNode.controlFor;
	const executeLocalDeviceAction = localNode.executeAction;

  const cacheKey = thingsCacheKey(user?.id);
  const cached = useMemo(() => readLocalCache<ThingsCache>(cacheKey), [cacheKey]);

  const [view, setView] = useState<ThingsView>(cached?.view || 'grid');
  const [displayMode, setDisplayMode] = useState<ThingsDisplayMode>(cached?.displayMode || 'name');
  const [sort, setSort] = useState<ThingsSort>(cached?.sort || 'newest');
  const [groupBy, setGroupBy] = useState<ThingsGroupBy>(cached?.groupBy || 'none');
  const [kindFilter, setKindFilter] = useState<ThingsKindFilter>('all');
  const [folderPages, setFolderPages] = useState<Record<string, ThingsThing[]>>(cached?.folders || {});
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [folderMeta, setFolderMeta] = useState<NonNullable<ThingsCache['folderMeta']>>(cached?.folderMeta || {});

  const [q, setQ] = useState('');
  const [searchResults, setSearchResults] = useState<ThingsThing[] | null>(null);
  const [searching, setSearching] = useState(false);
  // bumped after mutations (duplicate) so an active search re-fetches and the
  // fresh copies appear in the results the user is actually looking at
  const [searchSeq, setSearchSeq] = useState(0);

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const [clipboard, setClipboard] = useState<ThingsClipboard>(null);

  // drag-and-drop: the ids in flight + the folder currently hovered as a drop
  // target (null = the root row/breadcrumb, undefined = nothing hovered)
  const draggingIdsRef = useRef<string[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined);

  // schema shareId → its render template (null = fetched, none) for Previews
	const [schemaRenders, setSchemaRenders] = useState<NonNullable<ThingsCache['schemaRenders']>>(cached?.schemaRenders || {});
  const schemaFetchRef = useRef<Set<string>>(new Set());

  // right-click menus (the design-system Thing Context Menu, 'context'
  // presentation) — one instance for items, one for the background
  const itemMenu = useThingContextMenu();
  const backgroundMenu = useThingContextMenu();
  const [menuThing, setMenuThing] = useState<ThingsThing | null>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameThing, setRenameThing] = useState<ThingsThing | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [shareThings, setShareThings] = useState<ThingsThing[]>([]);
  const [deleteThings, setDeleteThings] = useState<ThingsThing[]>([]);
  const [previewThing, setPreviewThing] = useState<ThingsThing | null>(null);

	const dialogOpen = newFolderOpen || !!renameThing || moveOpen || !!shareThings.length || !!deleteThings.length || !!previewThing || !!deviceParam;

  // ------------------------------------------------------------------ data

  const rememberFolderMeta = useCallback((things: ThingsThing[]) => {
    const folders = things.filter(isFolder);
    if (!folders.length) return;
    setFolderMeta((prev) => {
      const next = { ...prev };
      for (const folder of folders) {
        next[folder.id] = {
          name: typeof folder.crystal?.name === 'string' ? folder.crystal.name : 'Folder',
          ...(typeof folder.crystal?.icon === 'string' && folder.crystal.icon ? { icon: folder.crystal.icon } : {}),
          folderId: folder.folderId
        };
      }
      return next;
    });
  }, []);

  const fetchSeqRef = useRef<Record<string, number>>({});

  const fetchFolder = useCallback(
    async (targetFolderId: string | null, cursor?: string | null) => {
      const key = folderKeyOf(targetFolderId);
      const seq = (fetchSeqRef.current[key] = (fetchSeqRef.current[key] || 0) + 1);
      setLoadingKeys((prev) => new Set(prev).add(key));
      try {
        const resp = await apiRef.current.v1.things.list({
          folder: targetFolderId || 'root',
          cursor: cursor || undefined,
          limit: PAGE_SIZE
        });
        if (fetchSeqRef.current[key] !== seq) return;
        const incoming: ThingsThing[] = resp?.things || [];
        setFolderPages((prev) => ({
          ...prev,
          [key]: cursor ? dedupeById([...(prev[key] || []), ...incoming]) : incoming
        }));
        setCursors((prev) => ({ ...prev, [key]: resp?.nextCursor || null }));
        rememberFolderMeta(incoming);
      } catch (err: any) {
        if (fetchSeqRef.current[key] === seq && folderKeyOf(targetFolderId) === folderKeyOf(searchParams.get('folder') || null)) {
          lopuRef.current({ title: 'Couldn’t load things 😔', description: err?.error || undefined, status: 'error' });
        }
      } finally {
        setLoadingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    // searchParams identity changes per navigation; the guard only reads it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rememberFolderMeta]
  );

  const ensureLoaded = useCallback(
    (targetFolderId: string | null) => {
      const key = folderKeyOf(targetFolderId);
      if (fetchSeqRef.current[key]) return; // fetched (or fetching) this session
      fetchFolder(targetFolderId);
    },
    [fetchFolder]
  );

  // current folder + the tree root refresh on login/folder change (cached
  // pages keep painting while these land — the optimistic house rule)
  useEffect(() => {
    if (!user) return;
    fetchFolder(folderId);
    if (currentKey !== 'root') ensureLoaded(null);
  }, [user?.id, folderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // deep-linked folder (?folder=) whose ancestry we haven't met yet — resolve
  // folder names upward so breadcrumbs/columns stay honest, cycle-safe
  useEffect(() => {
    if (!user || !folderId) return;
    let cancelled = false;
    (async () => {
      let cursor: string | null = folderId;
      const visited = new Set<string>();
      for (let hop = 0; cursor && hop < 64 && !visited.has(cursor); hop += 1) {
        visited.add(cursor);
        const known = folderMeta[cursor];
        if (known) {
          cursor = known.folderId;
          continue;
        }
        try {
          const resp = await apiRef.current.v1.things.get({ id: cursor });
          const thing: ThingsThing | undefined = resp?.thing;
          if (cancelled || !thing || !isFolder(thing)) return;
          rememberFolderMeta([thing]);
          cursor = thing.folderId;
        } catch {
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, folderId, folderMeta, rememberFolderMeta]);

  // ?preview= deep link — the shareable permalink for non-post things
  useEffect(() => {
    if (!previewParam) return;
    const local = Object.values(folderPages)
      .flat()
      .find((thing) => thing.id === previewParam);
    if (local) {
      setPreviewThing(local);
      return;
    }
    let cancelled = false;
    apiRef.current.v1.things
      .get({ id: previewParam })
      .then((resp: any) => {
        if (!cancelled && resp?.thing) setPreviewThing(resp.thing);
      })
      .catch(() => {
        if (!cancelled) lopuRef.current({ title: 'That thing isn’t viewable 🔒', status: 'info' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewParam]);

  // deep search across every folder (server-side, own things)
  useEffect(() => {
    const query = q.trim();
    if (!user || !query) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const resp = await apiRef.current.v1.things.search({
          q: query,
          author: user.username,
          thingtime: kindFilter === 'all' ? undefined : kindFilter,
          limit: PAGE_SIZE
        });
        if (cancelled) return;
        setSearchResults(resp?.things || []);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, kindFilter, searchSeq, user?.id, user?.username]);

  // persist the optimistic seed (writeLocalCache swallows quota errors)
  useEffect(() => {
    if (!user) return;
    const folders: Record<string, ThingsThing[]> = {};
    for (const [key, things] of Object.entries(folderPages)) folders[key] = things.slice(0, PAGE_SIZE);
    const cachedRenders = Object.fromEntries(Object.entries(schemaRenders).slice(0, MAX_CACHED_SCHEMA_RENDERS));
		writeLocalCache(cacheKey, { view, displayMode, sort, groupBy, folders, folderMeta, schemaRenders: cachedRenders } satisfies ThingsCache);
  }, [user?.id, cacheKey, view, displayMode, sort, groupBy, folderPages, folderMeta, schemaRenders]); // eslint-disable-line react-hooks/exhaustive-deps

  // custom sort/group orders the WHOLE folder, so keep pulling pages until the
  // cursor runs dry (bounded) — the default newest order pages lazily as before
  const arranged = sort !== 'newest' || groupBy !== 'none';
  useEffect(() => {
    if (!arranged || !user || searchMode) return;
    const cursor = cursors[currentKey];
    if (!cursor || loadingKeys.has(currentKey)) return;
    if ((folderPages[currentKey] || []).length >= MAX_ARRANGE_THINGS) return;
    fetchFolder(folderId, cursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arranged, user?.id, currentKey, cursors, loadingKeys, folderId]);

  // Previews: fetch the render template of every referenced community schema
  // once (data things stamp crystal.schemaId server-side). Missing/none caches
  // as null so a schema without a template is never re-fetched.
  useEffect(() => {
    if (displayMode !== 'preview' || !user) return;
    const everything = [...Object.values(folderPages).flat(), ...(searchResults || [])];
    for (const thing of everything) {
      const schemaId = schemaIdOf(thing);
      if (!schemaId || schemaRenders[schemaId] !== undefined || schemaFetchRef.current.has(schemaId)) continue;
      schemaFetchRef.current.add(schemaId);
      apiRef.current.v1.things
        .get({ id: schemaId })
        .then((resp: any) => {
          const schemaThing = resp?.thing;
          const render =
            schemaThing?.thingtime?.includes?.('schema') &&
            schemaThing?.crystal?.render &&
            typeof schemaThing.crystal.render === 'object' &&
            !Array.isArray(schemaThing.crystal.render)
              ? (schemaThing.crystal.render as Record<string, unknown>)
              : null;
          setSchemaRenders((prev) => ({ ...prev, [schemaId]: render }));
        })
        .catch(() => setSchemaRenders((prev) => ({ ...prev, [schemaId]: null })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode, folderPages, searchResults, user?.id]);

  const schemaRenderFor = useCallback(
    (thing: ThingsThing): Record<string, unknown> | null => {
      const schemaId = schemaIdOf(thing);
      return schemaId ? schemaRenders[schemaId] || null : null;
    },
    [schemaRenders]
  );

  // ------------------------------------------------------------------ derived

  const itemsFor = useCallback(
    (targetFolderId: string | null): ThingsThing[] | undefined => {
      const page = folderPages[folderKeyOf(targetFolderId)];
      if (!page) return undefined;
      return sortThings(
        page.filter((thing) => !HIDDEN_KINDS.has(primaryKindOf(thing))),
        sort
      );
    },
    [folderPages, sort]
  );

  const browseItems = useMemo(() => {
    const page = itemsFor(folderId) || [];
    if (kindFilter === 'all') return page;
    return page.filter((thing) => primaryKindOf(thing) === kindFilter);
  }, [itemsFor, folderId, kindFilter]);

  const searchMode = q.trim().length > 0;
  const displayItems = searchMode ? searchResults || [] : browseItems;
	const visibleDevices = useMemo<DeviceRuntimeState[]>(() => {
		if (!devicesEnabled || kindFilter !== 'all' || (!searchMode && folderId)) return [];
		const query = q.trim().toLocaleLowerCase();
		if (!query) return deviceStore.devices;
		return deviceStore.devices.filter((state) => {
			const summary = state.summary;
			if (!summary) return false;
			const searchable = [
				summary.name,
				summary.platform,
				summary.system?.model,
				summary.system?.osName,
				summary.system?.osVersion,
				...(state.snapshot?.observed.runningApps.flatMap((app) => [app.name, app.bundleId]) || []),
				...(state.snapshot?.connectors.flatMap((connector) => [connector.label, connector.kind]) || [])
			]
				.filter((value): value is string => typeof value === 'string')
				.join(' ')
				.toLocaleLowerCase();
			return searchable.includes(query);
		});
	}, [deviceStore.devices, devicesEnabled, folderId, kindFilter, q, searchMode]);

  const breadcrumbs = useMemo(() => {
    const trail: { id: string; name: string; icon?: string }[] = [];
    let cursor = folderId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor) && trail.length < 64) {
      visited.add(cursor);
      const meta = folderMeta[cursor];
      trail.unshift({ id: cursor, name: meta?.name || '…', icon: meta?.icon });
      cursor = meta?.folderId ?? null;
    }
    return trail;
  }, [folderId, folderMeta]);

  const columnsPath = useMemo<(string | null)[]>(() => [null, ...breadcrumbs.map((crumb) => crumb.id)], [breadcrumbs]);

  // columns view needs every folder on the path loaded — fetch from an effect,
  // never from the view's render (setState during render is a React error)
  useEffect(() => {
    if (view !== 'columns' || !user) return;
    for (const pathFolderId of columnsPath) ensureLoaded(pathFolderId);
  }, [view, columnsPath, ensureLoaded, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

	const cutIds = useMemo(() => new Set(clipboard?.mode === 'cut' ? clipboard.ids : []), [clipboard]);

  const selectedThings = useMemo(() => {
    const all = searchMode ? searchResults || [] : Object.values(folderPages).flat();
    const byId = new Map(all.map((thing) => [thing.id, thing]));
    return [...selection].map((id) => byId.get(id)).filter(Boolean) as ThingsThing[];
  }, [selection, folderPages, searchMode, searchResults]);

  // ------------------------------------------------------------------ actions

	const openDevice = useCallback(
		(deviceId: string) => {
			setSelection(new Set());
			anchorRef.current = null;
			setPreviewThing(null);
			setSearchParams(
				(previous) => {
					const next = new URLSearchParams(previous);
					next.set('device', deviceId);
					next.delete('preview');
					return next;
				},
				{ preventScrollReset: true }
			);
		},
		[setSearchParams]
	);

	const closeDevice = useCallback(() => {
		setSearchParams(
			(previous) => {
				const next = new URLSearchParams(previous);
				next.delete('device');
				return next;
			},
			{ preventScrollReset: true, replace: true }
		);
	}, [setSearchParams]);

	const deviceControlFor = useCallback<DeviceControlResolver>(
		(action, targetKey) => (LOCAL_DEVICE_ACTIONS.has(action) ? localDeviceControlFor(action, targetKey) : serverDeviceControlFor(action, targetKey)),
		[localDeviceControlFor, serverDeviceControlFor]
	);

	const onDeviceAction = useCallback(
		(intent: DeviceActionIntent) => {
			if (LOCAL_DEVICE_ACTIONS.has(intent.action)) executeLocalDeviceAction(intent);
			else void executeServerDeviceAction(intent);
		},
		[executeLocalDeviceAction, executeServerDeviceAction]
	);

  const navigateToFolder = useCallback(
    (targetFolderId: string | null) => {
      setSelection(new Set());
      anchorRef.current = null;
      setQ('');
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (targetFolderId) next.set('folder', targetFolderId);
          else next.delete('folder');
          next.delete('preview');
					next.delete('device');
          return next;
        },
        { preventScrollReset: true }
      );
    },
    [setSearchParams]
  );

  const closePreview = useCallback(() => {
    setPreviewThing(null);
    if (previewParam) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('preview');
          return next;
        },
        { preventScrollReset: true, replace: true }
      );
    }
  }, [previewParam, setSearchParams]);

  const refreshAfterMutation = useCallback(
    (touchedFolderKeys: Iterable<string | null>) => {
      const keys = new Set<string>([currentKey]);
      for (const key of touchedFolderKeys) keys.add(folderKeyOf(key));
      for (const key of keys) {
        if (fetchSeqRef.current[key]) fetchFolder(key === 'root' ? null : key);
      }
    },
    [currentKey, fetchFolder]
  );

  const openThing = useCallback(
    (thing: ThingsThing) => {
      if (isFolder(thing)) {
        navigateToFolder(thing.id);
        return;
      }
      if (thing.thingtime.includes('post')) {
        navigate(`/post/${thing.id}`);
        return;
      }
      // actions open their inspector — the /things half of the program loop
      if (thing.thingtime.includes('action')) {
        navigate(`/actions/${encodeURIComponent(thing.id)}`);
        return;
      }
      setPreviewThing(thing);
    },
    [navigate, navigateToFolder]
  );

  const toggleSelect = useCallback((thing: ThingsThing) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(thing.id)) next.delete(thing.id);
      else next.add(thing.id);
      return next;
    });
    anchorRef.current = thing.id;
  }, []);

  const clickSelect = useCallback(
    (thing: ThingsThing, event: React.MouseEvent) => {
      if (isMobile) {
        openThing(thing);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        toggleSelect(thing);
        return;
      }
      if (event.shiftKey && anchorRef.current) {
        const order = displayItems.map((entry) => entry.id);
        const from = order.indexOf(anchorRef.current);
        const to = order.indexOf(thing.id);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          setSelection(new Set(order.slice(lo, hi + 1)));
          return;
        }
      }
      setSelection(new Set([thing.id]));
      anchorRef.current = thing.id;
    },
    [displayItems, isMobile, openThing, toggleSelect]
  );

  const selectAll = useCallback(() => {
		setSelection((prev) => (prev.size === displayItems.length ? new Set() : new Set(displayItems.map((thing) => thing.id))));
  }, [displayItems]);

	const copyToClipboard = useCallback((mode: 'copy' | 'cut', ids: string[]) => {
      if (!ids.length) return;
      setClipboard({ mode, ids });
      lopuRef.current({
        title: mode === 'copy' ? `Copied ${ids.length} 📋` : `Cut ${ids.length} ✂️`,
        description: 'Paste into any folder.',
        status: 'info',
        duration: 5000
      });
	}, []);

	const runBulk = useCallback(async (op: 'move' | 'copy' | 'delete', ids: string[], destination?: string | null) => {
      try {
        const resp = await apiRef.current.v1.things.bulk({ op, ids, folderId: destination ?? null });
        const results: { id: string; ok: boolean; error?: string; newId?: string }[] = resp?.results || [];
        const failures = results.filter((entry) => !entry.ok);
        return { ok: true as const, succeeded: resp?.succeeded || 0, failures, results };
      } catch (err: any) {
        lopuRef.current({ title: 'That didn’t work 😔', description: err?.error || undefined, status: 'error' });
        return { ok: false as const, succeeded: 0, failures: [], results: [] };
      }
	}, []);

  const summarize = useCallback((verb: string, succeeded: number, failures: { error?: string }[]) => {
    if (!failures.length) {
      lopuRef.current({ title: `${verb} ${succeeded} ✨`, status: 'success', duration: 6000 });
    } else {
      lopuRef.current({
        title: `${verb} ${succeeded}, ${failures.length} skipped`,
        description: failures[0]?.error,
        status: failures.length && !succeeded ? 'error' : 'info'
      });
    }
  }, []);

  const sourceKeysOf = useCallback(
    (ids: string[]): (string | null)[] => {
      const idSet = new Set(ids);
      const keys: (string | null)[] = [];
      for (const [key, things] of Object.entries(folderPages)) {
        if (things.some((thing) => idSet.has(thing.id))) keys.push(key === 'root' ? null : key);
      }
      return keys;
    },
    [folderPages]
  );

  const pasteClipboardTo = useCallback(
    async (destination: string | null) => {
      if (!clipboard?.ids.length) return;
      const { mode, ids } = clipboard;
      const sources = sourceKeysOf(ids);
      const result = await runBulk(mode === 'cut' ? 'move' : 'copy', ids, destination);
      if (!result.ok) return;
      summarize(mode === 'cut' ? 'Moved' : 'Pasted', result.succeeded, result.failures);
      if (mode === 'cut') setClipboard(null);
      setSelection(new Set());
      refreshAfterMutation([...sources, destination]);
    },
    [clipboard, refreshAfterMutation, runBulk, sourceKeysOf, summarize]
  );

  const pasteClipboard = useCallback(() => pasteClipboardTo(folderId), [folderId, pasteClipboardTo]);

  // one-click Duplicate: bulk-copy each target into ITS OWN folder (beside the
  // original — NOT the browsed folder, which can differ when acting on search
  // results or ancestor columns), no clipboard round-trip. Originals are
  // untouched — the copy op mints NEW things through the real create path. The
  // response's per-item newIds let the copies paint instantly with REAL server
  // ids (createFolder pattern, never phantom rows) into the source folder's
  // page; the refetch right after reconciles authoritative crystals and order.
  const duplicateThings = useCallback(
    async (targets: ThingsThing[]) => {
      if (!targets.length) return;
      // one bulk copy per source folder, so every copy lands beside its original
      const groups = new Map<string | null, ThingsThing[]>();
      for (const thing of targets) {
        const sourceFolderId = thing.folderId ?? null;
        const group = groups.get(sourceFolderId);
        if (group) group.push(thing);
        else groups.set(sourceFolderId, [thing]);
      }
      let succeeded = 0;
      const failures: { error?: string }[] = [];
      let anyOk = false;
      const now = new Date().toISOString();
      for (const [sourceFolderId, group] of groups) {
        const result = await runBulk('copy', group.map((thing) => thing.id), sourceFolderId);
        if (!result.ok) continue; // runBulk already toasted the transport error
        anyOk = true;
        succeeded += result.succeeded;
        failures.push(...result.failures);
        const newIdBySource = new Map(
          result.results.filter((entry) => entry.ok && entry.newId).map((entry) => [entry.id, entry.newId as string])
        );
        if (!newIdBySource.size) continue;
        const copies: ThingsThing[] = group
          .filter((thing) => newIdBySource.has(thing.id))
          .map((thing) => ({
            ...thing,
            id: newIdBySource.get(thing.id) as string,
            folderId: sourceFolderId,
            // mirror the server's top-level copy naming (Copy of X for named
            // things) so the instant paint matches what the refetch confirms
            crystal:
              typeof thing.crystal?.name === 'string' && thing.crystal.name.trim()
                ? { ...thing.crystal, name: `Copy of ${thing.crystal.name}`.slice(0, 120) }
                : thing.crystal,
            createdAt: now,
            updatedAt: now
          }));
        const paintKey = folderKeyOf(sourceFolderId);
        setFolderPages((prev) => ({ ...prev, [paintKey]: dedupeById([...copies, ...(prev[paintKey] || [])]) }));
        rememberFolderMeta(copies);
      }
      if (!anyOk) return;
      summarize('Duplicated', succeeded, failures);
      setSelection(new Set());
      refreshAfterMutation([...groups.keys()]);
      // the search overlay hides folder pages — re-run the active search so the
      // fresh "Copy of X" rows show up where the user is actually looking
      if (searchMode) setSearchSeq((seq) => seq + 1);
    },
    [refreshAfterMutation, rememberFolderMeta, runBulk, searchMode, summarize]
  );

  // one move path for the Move dialog, drag-and-drop, and cut-paste-into
  const moveIdsTo = useCallback(
    async (ids: string[], destination: string | null) => {
      if (!ids.length) return false;
      const sources = sourceKeysOf(ids);
      const result = await runBulk('move', ids, destination);
      if (!result.ok) return false;
      summarize('Moved', result.succeeded, result.failures);
      setSelection(new Set());
      refreshAfterMutation([...sources, destination]);
      return true;
    },
    [refreshAfterMutation, runBulk, sourceKeysOf, summarize]
  );

  const deleteConfirmed = useCallback(async () => {
    const ids = deleteThings.map((thing) => thing.id);
    if (!ids.length) return false;
    const sources = sourceKeysOf(ids);
    // optimistic: rows vanish immediately, the refetch reconciles
    setFolderPages((prev) => {
      const next: typeof prev = {};
      const idSet = new Set(ids);
      for (const [key, things] of Object.entries(prev)) next[key] = things.filter((thing) => !idSet.has(thing.id));
      return next;
    });
    setSelection(new Set());
    const result = await runBulk('delete', ids);
    if (result.ok) summarize('Deleted', result.succeeded, result.failures);
    refreshAfterMutation(sources);
    return result.ok;
  }, [deleteThings, refreshAfterMutation, runBulk, sourceKeysOf, summarize]);

  const moveConfirmed = useCallback(
    async (destination: string | null) => {
      const ids = selectedThings.length ? selectedThings.map((thing) => thing.id) : previewThing ? [previewThing.id] : [];
      return moveIdsTo(ids, destination);
    },
    [moveIdsTo, previewThing, selectedThings]
  );

  // audience changes ride the bulk share op (per-item server results; folders
  // optionally flow the acl to everything inside)
  const shareApplied = useCallback(
    async (acl: string[], recursive: boolean) => {
      const targets = shareThings;
      if (!targets.length) return false;
      try {
        const resp = await apiRef.current.v1.things.bulk({
          op: 'share',
          ids: targets.map((thing) => thing.id),
          acl,
          recursive
        });
        const results: any[] = resp?.results || [];
        const failures = results.filter((entry) => !entry.ok);
        const inside = results.reduce((sum, entry) => sum + (entry.applied || 0), 0);
        const skippedInside = results.reduce((sum, entry) => sum + (entry.skipped || 0), 0);
        summarize('Updated audience for', resp?.succeeded || 0, failures);
        if (recursive && (inside || skippedInside)) {
          lopuRef.current({
            title: `Audience flowed to ${inside} thing${inside === 1 ? '' : 's'} inside 📂`,
						description: skippedInside ? `${skippedInside} skipped (attached things keep inheriting their target’s audience).` : undefined,
            status: 'info',
            duration: 6000
          });
        }
        // recursive shares touch the folders' own listings too, not just the
        // folders' parents — refresh both (already-fetched keys only)
        refreshAfterMutation([
          ...sourceKeysOf(targets.map((thing) => thing.id)),
          ...(recursive ? targets.filter(isFolder).map((thing) => thing.id) : [])
        ]);
        return failures.length === 0;
      } catch (err: any) {
        lopuRef.current({ title: 'That didn’t work 😔', description: err?.error || undefined, status: 'error' });
        return false;
      }
    },
    [refreshAfterMutation, shareThings, sourceKeysOf, summarize]
  );

  const renameApplied = useCallback(
    async (thing: ThingsThing, name: string) => {
      // optimistic rename, revert-by-refetch on failure
      setFolderPages((prev) => {
        const next: typeof prev = {};
        for (const [key, things] of Object.entries(prev)) {
					next[key] = things.map((entry) => (entry.id === thing.id ? { ...entry, crystal: { ...entry.crystal, name } } : entry));
        }
        return next;
      });
      if (isFolder(thing)) {
        setFolderMeta((prev) => ({ ...prev, [thing.id]: { ...(prev[thing.id] || { folderId: thing.folderId }), name } }));
      }
      try {
        await apiRef.current.v1.things.update({ id: thing.id, crystal: { name } });
        lopuRef.current({ title: 'Renamed ✏️', status: 'success', duration: 4000 });
        return true;
      } catch (err: any) {
        lopuRef.current({ title: 'Rename failed 😔', description: err?.error || undefined, status: 'error' });
        refreshAfterMutation(sourceKeysOf([thing.id]));
        return false;
      }
    },
    [refreshAfterMutation, sourceKeysOf]
  );

  const createFolder = useCallback(
    async (name: string, icon: string) => {
      try {
        const resp = await apiRef.current.v1.things.create({
          thingtime: ['folder'],
          crystal: { name, ...(icon ? { icon } : {}) },
          folderId
        });
        const thing: ThingsThing | undefined = resp?.thing;
        if (thing) {
          setFolderPages((prev) => ({ ...prev, [currentKey]: dedupeById([thing, ...(prev[currentKey] || [])]) }));
          rememberFolderMeta([thing]);
        }
        lopuRef.current({ title: `Folder “${name}” created 📁`, status: 'success', duration: 5000 });
        return true;
      } catch (err: any) {
        lopuRef.current({ title: 'Couldn’t create the folder 😔', description: err?.error || undefined, status: 'error' });
        return false;
      }
    },
    [currentKey, folderId, rememberFolderMeta]
  );

  const copyLink = useCallback(async (thing: ThingsThing) => {
    const url = `${window.location.origin}${thingLink(thing)}`;
    try {
      await navigator.clipboard.writeText(url);
      lopuRef.current({ title: 'Link copied 🔗', description: url, status: 'success', duration: 5000 });
    } catch {
      lopuRef.current({ title: 'Couldn’t copy the link', description: url, status: 'error' });
    }
  }, []);

  const onItemAction = useCallback(
    (thing: ThingsThing, action: ThingsItemAction) => {
      const group = selection.has(thing.id) && selection.size > 1 ? selectedThings : [thing];
      switch (action) {
        case 'open':
          openThing(thing);
          break;
        case 'preview':
          setPreviewThing(thing);
          break;
        case 'rename':
          setRenameThing(thing);
          break;
        case 'move':
          setSelection(new Set(group.map((entry) => entry.id)));
          setMoveOpen(true);
          break;
        case 'share':
          setShareThings(group);
          break;
        case 'copy':
          // folders copy their whole subtree server-side (bounded, honest)
					copyToClipboard(
						'copy',
						group.map((entry) => entry.id)
					);
          break;
        case 'cut':
					copyToClipboard(
						'cut',
						group.map((entry) => entry.id)
					);
          break;
        case 'duplicate':
          // server-side per-item results skip uncopyable kinds honestly
          duplicateThings(group);
          break;
        case 'copyLink':
          copyLink(thing);
          break;
        case 'delete':
          setDeleteThings(group);
          break;
      }
    },
    [copyLink, copyToClipboard, duplicateThings, openThing, selectedThings, selection]
  );

  // ------------------------------------------------------------------ drag & drop

  const onItemDragStart = useCallback(
    (thing: ThingsThing, event: React.DragEvent) => {
      const ids = selection.has(thing.id) && selection.size > 1 ? [...selection] : [thing.id];
      if (!selection.has(thing.id)) {
        setSelection(new Set([thing.id]));
        anchorRef.current = thing.id;
      }
      draggingIdsRef.current = ids;
      event.dataTransfer.effectAllowed = 'move';
      // some browsers need data set for the drag to start at all
      event.dataTransfer.setData('text/plain', `${ids.length} thing${ids.length === 1 ? '' : 's'}`);
    },
    [selection]
  );

  const onItemDragEnd = useCallback(() => {
    draggingIdsRef.current = [];
    setDropTarget(undefined);
  }, []);

  const onFolderDragOver = useCallback((target: string | null, event: React.DragEvent) => {
    if (!draggingIdsRef.current.length) return;
    // a folder can't be dropped into itself (the server also cycle-checks
    // deeper descendants — this just keeps the obvious case from highlighting)
    if (target && draggingIdsRef.current.includes(target)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget((prev) => (prev === target ? prev : target));
  }, []);

  const onFolderDragLeave = useCallback((target: string | null) => {
    setDropTarget((prev) => (prev === target ? undefined : prev));
  }, []);

  const onFolderDrop = useCallback(
    (target: string | null, event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const ids = draggingIdsRef.current.filter((id) => id !== target);
      draggingIdsRef.current = [];
      setDropTarget(undefined);
      if (!ids.length) return;
      moveIdsTo(ids, target);
    },
    [moveIdsTo]
  );

  // ------------------------------------------------------------------ context menus

  // right-click a thing: select it (Finder semantics) and open the item menu
  // at the pointer. Text selections keep the browser menu (copy).
  const onItemContextMenu = useCallback(
    (thing: ThingsThing, event: React.MouseEvent) => {
      const domSelection = window.getSelection?.();
      if (domSelection && !domSelection.isCollapsed && domSelection.toString().length > 0) return;
      backgroundMenu.closeMenu();
      if (!selection.has(thing.id)) {
        setSelection(new Set([thing.id]));
        anchorRef.current = thing.id;
      }
      setMenuThing(thing);
      itemMenu.openAtPointer(event);
    },
    [backgroundMenu.closeMenu, itemMenu.openAtPointer, selection] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // right-click the browse canvas (not an item): create/paste/arrange/select
  const onBackgroundContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
      const domSelection = window.getSelection?.();
      if (domSelection && !domSelection.isCollapsed && domSelection.toString().length > 0) return;
      itemMenu.closeMenu();
      setMenuThing(null);
      backgroundMenu.openAtPointer(event);
    },
    [backgroundMenu.openAtPointer, itemMenu.closeMenu] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const menuActCount = menuThing && selection.has(menuThing.id) && selection.size > 1 ? selection.size : 1;

  const itemMenuModel = useMemo(
    () =>
			menuThing ? buildThingsItemMenu({ thing: menuThing, actCount: menuActCount, clipboardCount: clipboard?.ids.length || 0 }) : { sections: [] },
    [menuThing, menuActCount, clipboard?.ids.length]
  );

  const onItemMenuAction = useCallback(
    ({ action }: ThingContextMenuAction) => {
      if (!menuThing) return;
      switch (action.command) {
        case 'open':
          openThing(menuThing);
          break;
        case 'copy-link':
          copyLink(menuThing);
          break;
        case 'rename':
          onItemAction(menuThing, 'rename');
          break;
        case 'move':
          onItemAction(menuThing, 'move');
          break;
        case 'share':
          onItemAction(menuThing, 'share');
          break;
        case 'copy':
          onItemAction(menuThing, 'copy');
          break;
        case 'cut':
          onItemAction(menuThing, 'cut');
          break;
        case 'duplicate':
          onItemAction(menuThing, 'duplicate');
          break;
        case 'paste-into':
          pasteClipboardTo(menuThing.id);
          break;
        case 'delete':
          onItemAction(menuThing, 'delete');
          break;
      }
    },
    [copyLink, menuThing, onItemAction, openThing, pasteClipboardTo]
  );

  const backgroundMenuModel = useMemo(
    () =>
      buildThingsBackgroundMenu({
        clipboardCount: clipboard?.ids.length || 0,
        itemCount: displayItems.length,
        sort,
        groupBy,
        view,
        displayMode
      }),
    [clipboard?.ids.length, displayItems.length, sort, groupBy, view, displayMode]
  );

  const onBackgroundMenuAction = useCallback(
    ({ action }: ThingContextMenuAction) => {
      const payload = (action.payload || {}) as {
        sort?: ThingsSort;
        groupBy?: ThingsGroupBy;
        view?: ThingsView;
        displayMode?: ThingsDisplayMode;
      };
      switch (action.command) {
        case 'new-folder':
          setNewFolderOpen(true);
          break;
        case 'paste':
          pasteClipboard();
          break;
        case 'select-all':
          selectAll();
          break;
        case 'set-sort':
          if (payload.sort) setSort(payload.sort);
          break;
        case 'set-group':
          if (payload.groupBy) setGroupBy(payload.groupBy);
          break;
        case 'set-view':
          if (payload.view) setView(payload.view);
          break;
        case 'set-display':
          if (payload.displayMode) setDisplayMode(payload.displayMode);
          break;
      }
    },
    [pasteClipboard, selectAll]
  );

  // context menus close on any outside press (their surfaces portal to <body>,
  // so this checks the class, not the React tree)
  useEffect(() => {
    if (!itemMenu.open && !backgroundMenu.open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.thing-context-menu')) return;
      itemMenu.closeMenu();
      backgroundMenu.closeMenu();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [itemMenu.open, backgroundMenu.open, itemMenu.closeMenu, backgroundMenu.closeMenu]);

  // ------------------------------------------------------------------ keyboard

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogOpen || itemMenu.open || backgroundMenu.open) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
      } else if (meta && event.key.toLowerCase() === 'c' && selection.size) {
        copyToClipboard('copy', [...selection]);
      } else if (meta && event.key.toLowerCase() === 'x' && selection.size) {
        copyToClipboard('cut', [...selection]);
      } else if (meta && event.key.toLowerCase() === 'v' && clipboard?.ids.length) {
        pasteClipboard();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selection.size) {
        event.preventDefault();
        setDeleteThings(selectedThings);
      } else if (event.key === 'Escape' && selection.size) {
        setSelection(new Set());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [backgroundMenu.open, clipboard, copyToClipboard, dialogOpen, itemMenu.open, pasteClipboard, selectAll, selectedThings, selection]);

  // ------------------------------------------------------------------ render

  if (!user) {
    return (
      <Flex
        alignItems="center"
        background="var(--tt-surface, #fafafb)"
        justifyContent="center"
        minHeight="100vh"
        paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
        width="100%"
      >
        <Flex alignItems="center" direction="column" gap={4} paddingX={4} textAlign="center">
          <Text fontSize="42px">📦</Text>
          <Text fontSize="24px" fontWeight={700} sx={{ background: RAINBOW_TEXT, backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Your things live here
          </Text>
          <Text color="var(--tt-muted, #9a9aa6)" fontSize="14px" maxWidth="360px">
            Log in to collect, organise, and share everything you make on Thingtime.
          </Text>
          <Button
            as={RouterLink}
            size="sm"
            to="/login"
            background="var(--tt-accent, hotpink)"
            color="var(--tt-accent-contrast, #ffffff)"
            _hover={{ opacity: 0.9 }}
          >
            Log in 🗝️
          </Button>
        </Flex>
      </Flex>
    );
  }

  const itemHandlers: ThingsItemHandlers = {
    selected: selection,
    cutIds,
    isMobile,
    onItemClick: clickSelect,
    onItemOpen: openThing,
    onItemToggle: toggleSelect,
    onItemAction,
    onItemContextMenu,
    onItemDragStart,
    onItemDragEnd,
    dropTargetId: dropTarget,
    onFolderDragOver,
    onFolderDragLeave,
    onFolderDrop
  };

  const treeDnd = { dropTargetId: dropTarget, onDragOver: onFolderDragOver, onDragLeave: onFolderDragLeave, onDrop: onFolderDrop };

  // drop-target props for the breadcrumb row (null = root)
  const crumbDropProps = (target: string | null) => ({
    onDragOver: (event: React.DragEvent) => onFolderDragOver(target, event),
    onDragLeave: () => onFolderDragLeave(target),
    onDrop: (event: React.DragEvent) => onFolderDrop(target, event),
    ...(dropTarget === target
			? {
					background: 'var(--tt-accent-soft, rgba(244, 114, 182, 0.14))',
					borderRadius: '6px',
					boxShadow: 'inset 0 0 0 2px var(--tt-accent, #f472b6)'
			  }
      : {})
  });

  const loading = loadingKeys.has(currentKey) && !folderPages[currentKey];
	const deviceSurfaceLoading = devicesEnabled && kindFilter === 'all' && (searchMode || !folderId) && deviceStore.loading && !visibleDevices.length;
	const canPaintContent = !loading || visibleDevices.length > 0;
  const allSelected = displayItems.length > 0 && displayItems.every((thing) => selection.has(thing.id));
  const moveDisabledIds = new Set(selectedThings.filter(isFolder).map((thing) => thing.id));
  // group-by renders one titled section per kind (grid/list; columns is
  // already hierarchical)
  const groupedSections = groupBy === 'kind' && view !== 'columns' ? groupThings(displayItems, groupBy) : null;
	const devicePresentation = {
		devices: visibleDevices,
		deviceCounts: deviceStore.countsById,
		selectedDeviceId: deviceParam,
		onDeviceSelect: openDevice
	};
	const searchResultCount = (searchResults || []).length + visibleDevices.length;

  return (
    <Flex
      background="var(--tt-surface, #fafafb)"
      justifyContent="center"
      minHeight="100vh"
      paddingBottom={16}
      paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
      width="100%"
    >
      <Flex direction="column" gap={4} maxWidth="100%" paddingTop={[4, 6]} paddingX={4} width={['100%', '100%', '1100px']}>
        <Flex alignItems="baseline" gap={3} wrap="wrap">
          <Text {...monoLabel}>Thingtime · Things</Text>
        </Flex>
				{devicesEnabled && !folderId && !searchMode ? (
					<LocalNodeSetupCard controlFor={localDeviceControlFor} onAction={executeLocalDeviceAction} state={localNode} />
				) : null}
        <Flex alignItems="center" gap={3} wrap="wrap">
          <Text
            as="h1"
            fontSize={['28px', '34px']}
            fontWeight={800}
            sx={{
              background: RAINBOW_TEXT,
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundSize: '300% 300%',
              animation: 'moving-rainbow 12s linear infinite'
            }}
          >
            Things
          </Text>
          <Box flex={1} />
          <Menu placement="bottom-end">
            <MenuButton as={Button} bg="var(--tt-accent, hotpink)" color="var(--tt-accent-contrast, #ffffff)" leftIcon={<Plus size={14} />} size="sm" _hover={{ opacity: 0.9 }}>
              New
            </MenuButton>
            <Portal>
              <MenuList fontSize="13px" zIndex={10250}>
                <MenuItem onClick={() => setNewFolderOpen(true)}>📁 New folder</MenuItem>
                <MenuItem as={RouterLink} to="/feed">
                  📝 New post
                </MenuItem>
                <MenuItem as={RouterLink} to="/schemas">
                  💎 New data thing
                </MenuItem>
              </MenuList>
            </Portal>
          </Menu>
        </Flex>

        {/* search — the same rainbow-ringed input /search uses, page-sized */}
        <Box borderRadius="var(--tt-radius-sm, 9px)" height="48px" overflow="hidden" padding="2px" position="relative" width="100%">
          <Rainbow instant opacity={0.6} position="absolute" repeats={2} thickness={10} />
          <Flex
            alignItems="center"
            background="var(--tt-card, #ffffff)"
            borderRadius="var(--tt-radius-xs, 7px)"
            gap={2}
            height="100%"
            paddingX={3}
            position="relative"
            width="100%"
            zIndex={1}
          >
            <SearchIcon color="var(--tt-faint, #b6b6c0)" size={16} />
            <Input
              _placeholder={{ color: 'var(--tt-muted, #9a9aa6)' }}
              border="none"
              fontSize="14px"
              height="100%"
              onChange={(event) => setQ(event.target.value)}
              padding={0}
							placeholder="Search all your things and computers…"
              value={q}
              variant="unstyled"
            />
            {q && (
              <Box as="button" color="var(--tt-faint, #b6b6c0)" onClick={() => setQ('')} type="button">
                <X size={14} />
              </Box>
            )}
          </Flex>
        </Box>

        {/* toolbar: browse controls stay available while contextual selection actions appear below */}
        <Flex alignItems="center" columnGap={4} rowGap={2} wrap="wrap">
          <ToolbarGroup label="view">
            <Button {...pillProps(view === 'grid')} leftIcon={<LayoutGrid size={13} />} onClick={() => setView('grid')}>
              Grid
            </Button>
            <Button {...pillProps(view === 'list')} leftIcon={<Rows3 size={13} />} onClick={() => setView('list')}>
              List
            </Button>
            <Button {...pillProps(view === 'columns')} leftIcon={<Columns3 size={13} />} onClick={() => setView('columns')}>
              Columns
            </Button>
          </ToolbarGroup>
          <ToolbarGroup label="show">
            <Button {...pillProps(displayMode === 'name')} leftIcon={<Tag size={13} />} onClick={() => setDisplayMode('name')}>
              Names
            </Button>
						<Button {...pillProps(displayMode === 'preview')} leftIcon={<Eye size={13} />} onClick={() => setDisplayMode('preview')}>
              Previews
            </Button>
          </ToolbarGroup>
          <ToolbarGroup label="arrange">
            <Menu placement="bottom-start">
              <MenuButton as={Button} {...pillProps(sort !== 'newest')} leftIcon={<ArrowUpDown size={13} />}>
                {THINGS_SORT_OPTIONS.find((option) => option.id === sort)?.label || 'Sort'}
              </MenuButton>
              <Portal>
                <MenuList fontSize="13px" zIndex={10250}>
                  {THINGS_SORT_OPTIONS.map((option) => (
										<MenuItem key={option.id} fontWeight={sort === option.id ? 600 : 400} onClick={() => setSort(option.id)}>
                      {option.icon} {option.label}
                    </MenuItem>
                  ))}
                </MenuList>
              </Portal>
            </Menu>
            <Menu placement="bottom-start">
              <MenuButton as={Button} {...pillProps(groupBy !== 'none')} leftIcon={<Layers size={13} />}>
                {groupBy === 'none' ? 'Group' : THINGS_GROUP_OPTIONS.find((option) => option.id === groupBy)?.label}
              </MenuButton>
              <Portal>
                <MenuList fontSize="13px" zIndex={10250}>
                  {THINGS_GROUP_OPTIONS.map((option) => (
										<MenuItem key={option.id} fontWeight={groupBy === option.id ? 600 : 400} onClick={() => setGroupBy(option.id)}>
                      {option.icon} {option.label}
                    </MenuItem>
                  ))}
                </MenuList>
              </Portal>
            </Menu>
          </ToolbarGroup>
          <ToolbarGroup label="kind" wrap>
            {THINGS_KIND_FILTERS.map((entry) => (
              <Button key={entry.id} {...pillProps(kindFilter === entry.id)} onClick={() => setKindFilter(entry.id)}>
                {entry.icon} {entry.label}
              </Button>
            ))}
          </ToolbarGroup>
          {clipboard?.ids.length ? (
            <>
              <Box flex={1} />
              <Button {...pillProps(true)} onClick={pasteClipboard}>
                📥 Paste {clipboard.ids.length} here
              </Button>
              <Button {...pillProps(false)} onClick={() => setClipboard(null)}>
                ✕
              </Button>
            </>
          ) : null}
        </Flex>

        {selection.size > 0 ? (
          <Flex
            alignItems="center"
            background="var(--tt-accent-soft, rgba(244, 114, 182, 0.08))"
            border="1px solid var(--tt-accent, #f472b6)"
            borderRadius="12px"
            gap={2}
            paddingX={3}
            paddingY={2}
            wrap="wrap"
          >
            <Text fontSize="13px" fontWeight={600}>
              {selection.size} selected
            </Text>
            <Box flex={1} />
            <Button {...pillProps(false)} onClick={() => setMoveOpen(true)}>
              📁 Move
            </Button>
            <Button {...pillProps(false)} onClick={() => setShareThings(selectedThings)}>
              🌐 Share
            </Button>
            <Button
              {...pillProps(false)}
							onClick={() =>
								copyToClipboard(
									'copy',
									selectedThings.filter((thing) => !isFolder(thing)).map((thing) => thing.id)
								)
							}
            >
              📋 Copy
            </Button>
            <Button {...pillProps(false)} onClick={() => copyToClipboard('cut', [...selection])}>
              ✂️ Cut
            </Button>
						<Button {...pillProps(false)} color="var(--tt-danger, #e5484d)" onClick={() => setDeleteThings(selectedThings)}>
              🗑️ Delete
            </Button>
            <Button {...pillProps(false)} onClick={() => setSelection(new Set())}>
              ✕ Clear
            </Button>
          </Flex>
        ) : null}

        {/* breadcrumbs — every crumb is also a drag-and-drop move target */}
        {!searchMode && (
          <Flex alignItems="center" color="var(--tt-muted, #9a9aa6)" fontSize="13px" gap={1} wrap="wrap">
            <Box
              as="button"
              fontWeight={folderId ? 400 : 600}
              onClick={() => navigateToFolder(null)}
              paddingX={1}
              type="button"
              {...crumbDropProps(null)}
            >
              🏠 All things
            </Box>
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={crumb.id}>
                <Text>/</Text>
                <Box
                  as="button"
                  fontWeight={index === breadcrumbs.length - 1 ? 600 : 400}
                  onClick={() => navigateToFolder(crumb.id)}
                  paddingX={1}
                  type="button"
                  {...crumbDropProps(crumb.id)}
                >
                  {crumb.icon || '📁'} {crumb.name}
                </Box>
              </React.Fragment>
            ))}
          </Flex>
        )}
        {searchMode && (
          <Text color="var(--tt-muted, #9a9aa6)" fontSize="13px">
						{searching
							? 'Searching all your folders…'
							: `${searchResultCount} result${searchResultCount === 1 ? '' : 's'} across your things and computers`}
          </Text>
        )}

        <Flex alignItems="flex-start" gap={4}>
          {/* folder tree sidebar (desktop, browse mode) */}
          {!isMobile && !searchMode && view !== 'columns' && (
            <Box flexShrink={0} paddingTop={1} width="220px">
							<FolderTree currentFolderId={folderId} dnd={treeDnd} ensureLoaded={ensureLoaded} itemsFor={itemsFor} onPick={navigateToFolder} />
            </Box>
          )}

          <Box flex={1} minHeight="45vh" minWidth={0} onContextMenu={onBackgroundContextMenu}>
						{loading && !visibleDevices.length && (
              <Text color="var(--tt-faint, #b6b6c0)" fontSize="13px" paddingY={6} textAlign="center">
                Loading your things… 🌀
              </Text>
            )}
						{!loading && deviceSurfaceLoading && !displayItems.length ? (
							<Text color="var(--tt-faint, #b6b6c0)" fontSize="13px" paddingY={6} textAlign="center">
								Finding your computers… 🖥️
							</Text>
						) : null}
						{canPaintContent &&
							view === 'grid' &&
              (groupedSections ? (
								<>
									{visibleDevices.length ? (
										<Box marginBottom={4}>
                    <Text {...monoLabel} marginBottom={2}>
												🖥️ Devices · {visibleDevices.length}
                    </Text>
                    <ThingsGridView
												{...devicePresentation}
                      displayMode={displayMode}
                      handlers={itemHandlers}
												items={[]}
                      schemaRenderFor={schemaRenderFor}
                    />
                  </Box>
									) : null}
									{groupedSections.map((section) => (
										<Box key={section.key} marginBottom={4}>
											<Text {...monoLabel} marginBottom={2}>
												{section.icon} {section.label} · {section.items.length}
											</Text>
											<ThingsGridView displayMode={displayMode} handlers={itemHandlers} items={section.items} schemaRenderFor={schemaRenderFor} />
										</Box>
									))}
								</>
              ) : (
                <ThingsGridView
									{...devicePresentation}
                  displayMode={displayMode}
                  handlers={itemHandlers}
                  items={displayItems}
                  schemaRenderFor={schemaRenderFor}
                />
              ))}
						{canPaintContent &&
							view === 'list' &&
              (groupedSections ? (
								<>
									{visibleDevices.length ? (
										<Box marginBottom={4}>
											<Text {...monoLabel} marginBottom={2}>
												🖥️ Devices · {visibleDevices.length}
											</Text>
											<ThingsListView
												{...devicePresentation}
												allSelected={false}
												displayMode={displayMode}
												handlers={itemHandlers}
												items={[]}
												onToggleAll={selectAll}
												schemaRenderFor={schemaRenderFor}
											/>
										</Box>
									) : null}
									{groupedSections.map((section) => (
                  <Box key={section.key} marginBottom={4}>
                    <Text {...monoLabel} marginBottom={2}>
                      {section.icon} {section.label} · {section.items.length}
                    </Text>
                    <ThingsListView
                      allSelected={allSelected}
                      displayMode={displayMode}
                      handlers={itemHandlers}
                      items={section.items}
                      onToggleAll={selectAll}
                      schemaRenderFor={schemaRenderFor}
                    />
                  </Box>
									))}
								</>
              ) : (
                <ThingsListView
									{...devicePresentation}
                  allSelected={allSelected}
                  displayMode={displayMode}
                  handlers={itemHandlers}
                  items={displayItems}
                  onToggleAll={selectAll}
                  schemaRenderFor={schemaRenderFor}
                />
              ))}
						{canPaintContent && view === 'columns' && !searchMode && (
              <ThingsColumnsView
								{...devicePresentation}
                activeFolderAt={(depth) => columnsPath[depth + 1] ?? null}
                displayMode={displayMode}
                handlers={itemHandlers}
                itemsFor={itemsFor}
                onOpenFolderAt={(_depth, id) => navigateToFolder(id)}
                path={columnsPath}
                schemaRenderFor={schemaRenderFor}
              />
            )}
						{canPaintContent && view === 'columns' && searchMode && (
              <ThingsGridView
								{...devicePresentation}
                displayMode={displayMode}
                handlers={itemHandlers}
                items={displayItems}
                schemaRenderFor={schemaRenderFor}
              />
            )}

						{canPaintContent && !displayItems.length && !visibleDevices.length && !searching && !deviceSurfaceLoading && (
              <Flex
                alignItems="center"
                border="1px dashed var(--tt-border, #ececef)"
                borderRadius="var(--tt-radius-lg, 16px)"
                color="var(--tt-muted, #9a9aa6)"
                direction="column"
                gap={2}
                paddingY={10}
              >
                <Text fontSize="28px">{searchMode ? '🔍' : '🪺'}</Text>
								<Text fontSize="13px">{searchMode ? 'Nothing matched that search.' : 'Nothing here yet — create something with New ✨'}</Text>
              </Flex>
            )}

            {!searchMode && cursors[currentKey] && view !== 'columns' && (
              <Flex justifyContent="center" paddingY={4}>
                <Button onClick={() => fetchFolder(folderId, cursors[currentKey])} size="sm" variant="outline">
                  Load more
                </Button>
              </Flex>
            )}
          </Box>
        </Flex>
      </Flex>

			<DeviceDetailsDrawer
				controlFor={deviceControlFor}
				isOpen={Boolean(deviceParam)}
				onAction={onDeviceAction}
				onClose={closeDevice}
				onPermissionModeChange={setDevicePermissionMode}
				screenAvailability="not-installed"
				state={deviceStore.selectedState}
			/>

      {/* dialogs */}
      <NewFolderDialog isOpen={newFolderOpen} onClose={() => setNewFolderOpen(false)} onCreate={createFolder} />
      <RenameDialog onClose={() => setRenameThing(null)} onRename={renameApplied} thing={renameThing} />
      <MoveDialog
        count={selectedThings.length || (previewThing ? 1 : 0)}
        isOpen={moveOpen}
        onClose={() => setMoveOpen(false)}
        onMove={moveConfirmed}
        treeProps={{ itemsFor, ensureLoaded, disabledIds: moveDisabledIds }}
      />
      <ShareDialog onApply={shareApplied} onClose={() => setShareThings([])} things={shareThings} />
      <DeleteConfirmDialog onClose={() => setDeleteThings([])} onConfirm={deleteConfirmed} things={deleteThings} />
      <PreviewModal
        onAction={(thing, action) => {
          closePreview();
          onItemAction(thing, action);
        }}
        onClose={closePreview}
        thing={previewThing}
      />

      {/* right-click menus — the design-system Thing Context Menu surface */}
      <ThingContextMenu
        {...itemMenu.menuProps}
        meta={
          menuThing
            ? { path: thingDisplayName(menuThing), type: menuActCount > 1 ? `${menuActCount} selected` : primaryKindOf(menuThing) }
            : undefined
        }
        model={itemMenuModel}
        onAction={onItemMenuAction}
      />
      <ThingContextMenu
        {...backgroundMenu.menuProps}
        meta={{
          path: folderId ? breadcrumbs[breadcrumbs.length - 1]?.name || 'Folder' : 'All things',
          type: `${displayItems.length} thing${displayItems.length === 1 ? '' : 's'}`
        }}
        model={backgroundMenuModel}
        onAction={onBackgroundMenuAction}
      />
    </Flex>
  );
};
