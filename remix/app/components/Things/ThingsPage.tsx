import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Box, Button, Flex, Input, Menu, MenuButton, MenuItem, MenuList, Portal, Text } from '@chakra-ui/react';
import { Columns3, Eye, LayoutGrid, Plus, Rows3, Search as SearchIcon, Tag, X } from 'lucide-react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { useIsMobileViewport } from '~/components/Nav/Drawer/useDrawer';
import { Rainbow } from '~/components/Rainbow/Rainbow';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { RAINBOW_TEXT } from '~/theme/rainbow';

import { FolderTree } from './FolderTree';
import { DeleteConfirmDialog, MoveDialog, NewFolderDialog, PreviewModal, RenameDialog, ShareDialog } from './ThingsDialogs';
import { ThingsColumnsView, ThingsGridView, ThingsItemAction, ThingsItemHandlers, ThingsListView } from './ThingsViews';
import {
  THINGS_KIND_FILTERS,
  ThingsCache,
  ThingsClipboard,
  ThingsDisplayMode,
  ThingsKindFilter,
  ThingsThing,
  ThingsView,
  folderKeyOf,
  isFolder,
  primaryKindOf,
  sortForBrowse,
  thingDisplayName,
  thingLink,
  thingsCacheKey
} from './thingsCore';

const PAGE_SIZE = 50;
// listing noise: reaction/save things are mechanical children, not content
const HIDDEN_KINDS = new Set(['reaction', 'save']);

const pillProps = (active: boolean) =>
  ({
    background: active ? 'var(--tt-accent-soft, rgba(244, 114, 182, 0.12))' : 'transparent',
    border: '1px solid',
    borderColor: active ? 'var(--tt-accent, #f472b6)' : 'var(--tt-border, #ececef)',
    borderRadius: '999px',
    color: 'var(--tt-text, #26262b)',
    fontSize: '12px',
    fontWeight: 500,
    height: '26px',
    paddingX: 3,
    variant: 'unstyled' as const,
    display: 'inline-flex',
    alignItems: 'center'
  }) as const;

const monoLabel = {
  color: 'var(--tt-faint, #b6b6c0)',
  fontFamily: 'var(--tt-font-mono, monospace)',
  fontSize: '10px',
  textTransform: 'uppercase'
} as const;

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
  const currentKey = folderKeyOf(folderId);

  const cacheKey = thingsCacheKey(user?.id);
  const cached = useMemo(() => readLocalCache<ThingsCache>(cacheKey), [cacheKey]);

  const [view, setView] = useState<ThingsView>(cached?.view || 'grid');
  const [displayMode, setDisplayMode] = useState<ThingsDisplayMode>(cached?.displayMode || 'name');
  const [kindFilter, setKindFilter] = useState<ThingsKindFilter>('all');
  const [folderPages, setFolderPages] = useState<Record<string, ThingsThing[]>>(cached?.folders || {});
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [folderMeta, setFolderMeta] = useState<NonNullable<ThingsCache['folderMeta']>>(cached?.folderMeta || {});

  const [q, setQ] = useState('');
  const [searchResults, setSearchResults] = useState<ThingsThing[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const [clipboard, setClipboard] = useState<ThingsClipboard>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameThing, setRenameThing] = useState<ThingsThing | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [shareThings, setShareThings] = useState<ThingsThing[]>([]);
  const [deleteThings, setDeleteThings] = useState<ThingsThing[]>([]);
  const [previewThing, setPreviewThing] = useState<ThingsThing | null>(null);

  const dialogOpen =
    newFolderOpen || !!renameThing || moveOpen || !!shareThings.length || !!deleteThings.length || !!previewThing;

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
  }, [q, kindFilter, user?.id, user?.username]);

  // persist the optimistic seed (writeLocalCache swallows quota errors)
  useEffect(() => {
    if (!user) return;
    const folders: Record<string, ThingsThing[]> = {};
    for (const [key, things] of Object.entries(folderPages)) folders[key] = things.slice(0, PAGE_SIZE);
    writeLocalCache(cacheKey, { view, displayMode, folders, folderMeta } satisfies ThingsCache);
  }, [user?.id, cacheKey, view, displayMode, folderPages, folderMeta]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ derived

  const itemsFor = useCallback(
    (targetFolderId: string | null): ThingsThing[] | undefined => {
      const page = folderPages[folderKeyOf(targetFolderId)];
      if (!page) return undefined;
      return sortForBrowse(page.filter((thing) => !HIDDEN_KINDS.has(primaryKindOf(thing))));
    },
    [folderPages]
  );

  const browseItems = useMemo(() => {
    const page = itemsFor(folderId) || [];
    if (kindFilter === 'all') return page;
    return page.filter((thing) => primaryKindOf(thing) === kindFilter);
  }, [itemsFor, folderId, kindFilter]);

  const searchMode = q.trim().length > 0;
  const displayItems = searchMode ? searchResults || [] : browseItems;

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

  const cutIds = useMemo(
    () => new Set(clipboard?.mode === 'cut' ? clipboard.ids : []),
    [clipboard]
  );

  const selectedThings = useMemo(() => {
    const all = searchMode ? searchResults || [] : Object.values(folderPages).flat();
    const byId = new Map(all.map((thing) => [thing.id, thing]));
    return [...selection].map((id) => byId.get(id)).filter(Boolean) as ThingsThing[];
  }, [selection, folderPages, searchMode, searchResults]);

  // ------------------------------------------------------------------ actions

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
    setSelection((prev) =>
      prev.size === displayItems.length ? new Set() : new Set(displayItems.map((thing) => thing.id))
    );
  }, [displayItems]);

  const copyToClipboard = useCallback(
    (mode: 'copy' | 'cut', ids: string[]) => {
      if (!ids.length) return;
      setClipboard({ mode, ids });
      lopuRef.current({
        title: mode === 'copy' ? `Copied ${ids.length} 📋` : `Cut ${ids.length} ✂️`,
        description: 'Paste into any folder.',
        status: 'info',
        duration: 5000
      });
    },
    []
  );

  const runBulk = useCallback(
    async (op: 'move' | 'copy' | 'delete', ids: string[], destination?: string | null) => {
      try {
        const resp = await apiRef.current.v1.things.bulk({ op, ids, folderId: destination ?? null });
        const failures = (resp?.results || []).filter((entry: any) => !entry.ok);
        return { ok: true as const, succeeded: resp?.succeeded || 0, failures };
      } catch (err: any) {
        lopuRef.current({ title: 'That didn’t work 😔', description: err?.error || undefined, status: 'error' });
        return { ok: false as const, succeeded: 0, failures: [] };
      }
    },
    []
  );

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

  const pasteClipboard = useCallback(async () => {
    if (!clipboard?.ids.length) return;
    const { mode, ids } = clipboard;
    const sources = sourceKeysOf(ids);
    const result = await runBulk(mode === 'cut' ? 'move' : 'copy', ids, folderId);
    if (!result.ok) return;
    summarize(mode === 'cut' ? 'Moved' : 'Pasted', result.succeeded, result.failures);
    if (mode === 'cut') setClipboard(null);
    setSelection(new Set());
    refreshAfterMutation(sources);
  }, [clipboard, folderId, refreshAfterMutation, runBulk, sourceKeysOf, summarize]);

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
      if (!ids.length) return false;
      const sources = sourceKeysOf(ids);
      const result = await runBulk('move', ids, destination);
      if (!result.ok) return false;
      summarize('Moved', result.succeeded, result.failures);
      setSelection(new Set());
      refreshAfterMutation([...sources, destination]);
      return true;
    },
    [previewThing, refreshAfterMutation, runBulk, selectedThings, sourceKeysOf, summarize]
  );

  const shareApplied = useCallback(
    async (acl: string[]) => {
      const targets = shareThings;
      if (!targets.length) return false;
      let succeeded = 0;
      const failures: { error?: string }[] = [];
      for (const thing of targets) {
        try {
          await apiRef.current.v1.things.update({ id: thing.id, acl });
          succeeded += 1;
        } catch (err: any) {
          failures.push({ error: err?.error });
        }
      }
      summarize('Updated audience for', succeeded, failures);
      refreshAfterMutation(sourceKeysOf(targets.map((thing) => thing.id)));
      return failures.length === 0;
    },
    [refreshAfterMutation, shareThings, sourceKeysOf, summarize]
  );

  const renameApplied = useCallback(
    async (thing: ThingsThing, name: string) => {
      // optimistic rename, revert-by-refetch on failure
      setFolderPages((prev) => {
        const next: typeof prev = {};
        for (const [key, things] of Object.entries(prev)) {
          next[key] = things.map((entry) =>
            entry.id === thing.id ? { ...entry, crystal: { ...entry.crystal, name } } : entry
          );
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
          copyToClipboard('copy', group.filter((entry) => !isFolder(entry)).map((entry) => entry.id));
          break;
        case 'cut':
          copyToClipboard('cut', group.map((entry) => entry.id));
          break;
        case 'copyLink':
          copyLink(thing);
          break;
        case 'delete':
          setDeleteThings(group);
          break;
      }
    },
    [copyLink, copyToClipboard, openThing, selectedThings, selection]
  );

  // ------------------------------------------------------------------ keyboard

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogOpen) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
      } else if (meta && event.key.toLowerCase() === 'c' && selection.size) {
        copyToClipboard('copy', selectedThings.filter((thing) => !isFolder(thing)).map((thing) => thing.id));
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
  }, [clipboard, copyToClipboard, dialogOpen, pasteClipboard, selectAll, selectedThings, selection]);

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
          <Button as={RouterLink} colorScheme="pink" size="sm" to="/login">
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
    onItemAction
  };

  const loading = loadingKeys.has(currentKey) && !folderPages[currentKey];
  const allSelected = displayItems.length > 0 && displayItems.every((thing) => selection.has(thing.id));
  const moveDisabledIds = new Set(selectedThings.filter(isFolder).map((thing) => thing.id));

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
            <MenuButton as={Button} colorScheme="pink" leftIcon={<Plus size={14} />} size="sm">
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
              placeholder="Search all your things…"
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

        {/* toolbar: selection actions replace browse pills while selecting */}
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
              onClick={() => copyToClipboard('copy', selectedThings.filter((thing) => !isFolder(thing)).map((thing) => thing.id))}
            >
              📋 Copy
            </Button>
            <Button {...pillProps(false)} onClick={() => copyToClipboard('cut', [...selection])}>
              ✂️ Cut
            </Button>
            <Button
              {...pillProps(false)}
              color="var(--tt-danger, #e5484d)"
              onClick={() => setDeleteThings(selectedThings)}
            >
              🗑️ Delete
            </Button>
            <Button {...pillProps(false)} onClick={() => setSelection(new Set())}>
              ✕ Clear
            </Button>
          </Flex>
        ) : (
          <Flex alignItems="center" gap={2} wrap="wrap">
            <Text {...monoLabel}>view</Text>
            <Button {...pillProps(view === 'grid')} leftIcon={<LayoutGrid size={13} />} onClick={() => setView('grid')}>
              Grid
            </Button>
            <Button {...pillProps(view === 'list')} leftIcon={<Rows3 size={13} />} onClick={() => setView('list')}>
              List
            </Button>
            <Button {...pillProps(view === 'columns')} leftIcon={<Columns3 size={13} />} onClick={() => setView('columns')}>
              Columns
            </Button>
            <Box width={2} />
            <Text {...monoLabel}>show</Text>
            <Button {...pillProps(displayMode === 'name')} leftIcon={<Tag size={13} />} onClick={() => setDisplayMode('name')}>
              Names
            </Button>
            <Button
              {...pillProps(displayMode === 'preview')}
              leftIcon={<Eye size={13} />}
              onClick={() => setDisplayMode('preview')}
            >
              Previews
            </Button>
            <Box width={2} />
            <Text {...monoLabel}>kind</Text>
            {THINGS_KIND_FILTERS.map((entry) => (
              <Button key={entry.id} {...pillProps(kindFilter === entry.id)} onClick={() => setKindFilter(entry.id)}>
                {entry.icon} {entry.label}
              </Button>
            ))}
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
        )}

        {/* breadcrumbs */}
        {!searchMode && (
          <Flex alignItems="center" color="var(--tt-muted, #9a9aa6)" fontSize="13px" gap={1} wrap="wrap">
            <Box
              as="button"
              fontWeight={folderId ? 400 : 600}
              onClick={() => navigateToFolder(null)}
              type="button"
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
                  type="button"
                >
                  {crumb.icon || '📁'} {crumb.name}
                </Box>
              </React.Fragment>
            ))}
          </Flex>
        )}
        {searchMode && (
          <Text color="var(--tt-muted, #9a9aa6)" fontSize="13px">
            {searching ? 'Searching all your folders…' : `${(searchResults || []).length} result${(searchResults || []).length === 1 ? '' : 's'} across all folders`}
          </Text>
        )}

        <Flex alignItems="flex-start" gap={4}>
          {/* folder tree sidebar (desktop, browse mode) */}
          {!isMobile && !searchMode && view !== 'columns' && (
            <Box flexShrink={0} paddingTop={1} width="220px">
              <FolderTree
                currentFolderId={folderId}
                ensureLoaded={ensureLoaded}
                itemsFor={itemsFor}
                onPick={navigateToFolder}
              />
            </Box>
          )}

          <Box flex={1} minWidth={0}>
            {loading && (
              <Text color="var(--tt-faint, #b6b6c0)" fontSize="13px" paddingY={6} textAlign="center">
                Loading your things… 🌀
              </Text>
            )}
            {!loading && view === 'grid' && <ThingsGridView displayMode={displayMode} handlers={itemHandlers} items={displayItems} />}
            {!loading && view === 'list' && (
              <ThingsListView
                allSelected={allSelected}
                displayMode={displayMode}
                handlers={itemHandlers}
                items={displayItems}
                onToggleAll={selectAll}
              />
            )}
            {!loading && view === 'columns' && !searchMode && (
              <ThingsColumnsView
                activeFolderAt={(depth) => columnsPath[depth + 1] ?? null}
                displayMode={displayMode}
                handlers={itemHandlers}
                itemsFor={itemsFor}
                onOpenFolderAt={(_depth, id) => navigateToFolder(id)}
                path={columnsPath}
              />
            )}
            {!loading && view === 'columns' && searchMode && (
              <ThingsGridView displayMode={displayMode} handlers={itemHandlers} items={displayItems} />
            )}

            {!loading && !displayItems.length && !searching && (
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
                <Text fontSize="13px">
                  {searchMode ? 'Nothing matched that search.' : 'Nothing here yet — create something with New ✨'}
                </Text>
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
    </Flex>
  );
};
