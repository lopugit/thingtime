import React from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { SettingsDocumentHost } from '~/components/Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions, type TransientBlockInvocation } from '~/components/Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '~/components/Builder/WebpageBlocksRenderer';
import { commanderSearchResults, type CommanderSearchResult } from '~/components/Search/commanderSearch';
import type { SearchResponse } from '~/components/Search/searchTypes';
import { useDrawer } from './useDrawer';
import { customDrawerBlocks } from './customDrawerBlocks';
import { customDrawerUrl, updateCustomDrawerDraft, type CustomDrawerItem } from './drawerCustomItems';
const ADD_FROM_PREVIEW = 'thingtime:custom-drawer-add';
const emptyDraft = (): CustomDrawerItem => ({ id: '', emoji: '🔗', title: '', tooltip: '', url: '' });
export function CustomDrawerItems({ settings = false, preview = false, onNavigate }: { settings?: boolean; preview?: boolean; onNavigate?: () => void }) {
 const user = useCurrentUser();
 const dataPlane = useDataPlane();
 const scope = `${typeof window === 'undefined' ? '' : window.location.origin}:${user?.id || 'anonymous'}:${dataPlane || 'unavailable'}`;
 return <CustomDrawerScope key={scope} scopeKey={scope} settings={settings} preview={preview} onNavigate={onNavigate} />;
}
function CustomDrawerScope({ scopeKey, settings, preview, onNavigate }: { scopeKey: string; settings: boolean; preview: boolean; onNavigate?: () => void }) {
 const { customItems, setCustomItems, closesOnClick, setCloseOnClickFor, setOpen: setDrawerOpen } = useDrawer();
 const api = useApi(); const navigate = useNavigate(); const user = useCurrentUser();
 const [open, setOpen] = React.useState(false); const [draft, setDraft] = React.useState(emptyDraft);
 const [editorGeneration, setEditorGeneration] = React.useState(0);
 const [nextCursor, setNextCursor] = React.useState<string | null>(null);
 const [saving, setSaving] = React.useState(false); const busy = React.useRef(false);
 const alive = React.useRef(true);
 React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 const [managementError, setManagementError] = React.useState('');
 const [error, setError] = React.useState(''); const [query, setQuery] = React.useState('');
 const [results, setResults] = React.useState<CommanderSearchResult[]>([]); const [searchMessage, setSearchMessage] = React.useState('');
 const host = React.useRef<HTMLDivElement>(null);
 const seq = React.useRef(0); const apiRef = React.useRef(api); apiRef.current = api;
 const blocks = React.useMemo(() => customDrawerBlocks(settings), [settings]);
 React.useEffect(() => {
  const current = ++seq.current;
  if (!open || !query.trim()) { setResults([]); setNextCursor(null); setSearchMessage(''); return; }
  setResults([]); setNextCursor(null); setSearchMessage('Searching Things…');
  const timer = window.setTimeout(async () => {
   try {
    const response = await apiRef.current.v1.things.search({ q: query.trim(), limit: 8, anon: user?.id ? undefined : 1 }) as SearchResponse;
    if (current !== seq.current) return;
    if (!response?.ok) throw new Error('search unavailable');
    const next = commanderSearchResults({ query, things: response.things, posts: response.posts, thingLimit: response.things.length });
    setResults(next); setNextCursor(response.nextCursor); setSearchMessage(next.length ? 'Choose a Thing to attach.' : 'No matching Things. Try another search.');
   } catch { if (current === seq.current) { setResults([]); setSearchMessage('Things could not be searched. Try again by changing the search.'); } }
  }, 250);
  return () => { window.clearTimeout(timer); seq.current++; };
 }, [open, query, user?.id]);
 React.useEffect(() => {
  if (settings || preview) return;
  const add = () => { setDraft(emptyDraft()); setEditorGeneration(value => value + 1); setError(''); setOpen(true); };
  window.addEventListener(ADD_FROM_PREVIEW, add);
  return () => window.removeEventListener(ADD_FROM_PREVIEW, add);
 }, [settings, preview]);
 const close = () => { if (busy.current) return; seq.current++; setOpen(false); setResults([]); setQuery(''); setError(''); setDraft(emptyDraft()); window.requestAnimationFrame(() => host.current?.querySelector<HTMLButtonElement>('[data-block-id="custom-drawer-add"]')?.focus()); };
 const readDraft = (invocation: TransientBlockInvocation) => updateCustomDrawerDraft(draft, {
  emoji: String(invocation.readField('drawer-emoji') ?? draft.emoji), title: String(invocation.readField('drawer-title') ?? draft.title),
  tooltip: String(invocation.readField('drawer-tooltip') ?? draft.tooltip), url: String(invocation.readField('drawer-url') ?? draft.url) });
 const actions: TransientBlockActions = {
  'drawer.add': () => { if (busy.current) return; if (preview) { setDrawerOpen(true); window.dispatchEvent(new Event(ADD_FROM_PREVIEW)); onNavigate?.(); return; } setDraft(emptyDraft()); setEditorGeneration(value => value + 1); setError(''); setOpen(true); },
  'drawer.edit': ({ inputs }) => { if (busy.current) return; const item = customItems.find(item => item.id === inputs.id); if (item) { setDraft({ ...item }); setEditorGeneration(value => value + 1); setError(''); setOpen(true); } },
  'drawer.cancel': close,
  'drawer.remove': async ({ inputs, signal }) => {
   if (busy.current) return;
   busy.current = true; setSaving(true); setManagementError('');
   try { await setCustomItems(customItems.filter(item => item.id !== inputs.id), signal); }
   catch { if (!signal.aborted) setManagementError('The item could not be removed. Your previous drawer items have been restored. Please try again.'); }
   finally { busy.current = false; if (alive.current) setSaving(false); }
  },
  'drawer.close-setting': ({ inputs, value }) => { if (customItems.some(item => item.id === inputs.id)) setCloseOnClickFor(String(inputs.id), value === true); },
  'drawer.search': invocation => { setDraft(readDraft(invocation)); setQuery(String(invocation.value || '')); },
  'drawer.attach': invocation => {
   const selected = results.find(item => item.id === invocation.inputs.id); if (!selected) return;
   const current = readDraft(invocation);
   setDraft({ ...current, thingId: selected.id, thingTitle: selected.title, url: selected.href, title: current.title || selected.title, emoji: current.emoji === '🔗' ? selected.icon : current.emoji });
   setEditorGeneration(value => value + 1); setQuery(''); setResults([]); setNextCursor(null);
  },
  'drawer.more': async ({ signal }) => {
   if (!nextCursor) return;
   const current = ++seq.current; setNextCursor(null); setSearchMessage('Searching more Things…');
   try {
    const response = await apiRef.current.v1.things.search({ q: query.trim(), limit: 8, cursor: nextCursor, anon: user?.id ? undefined : 1 }) as SearchResponse;
    if (signal.aborted || current !== seq.current) return;
    if (!response?.ok) throw new Error('search unavailable');
    const next = commanderSearchResults({ query, things: response.things, posts: response.posts, thingLimit: response.things.length });
    setResults(previous => [...previous, ...next.filter(item => !previous.some(existing => existing.id === item.id))]);
    setNextCursor(response.nextCursor); setSearchMessage('Choose a Thing to attach.');
   } catch { if (!signal.aborted && current === seq.current) { setNextCursor(nextCursor); setSearchMessage('More Things could not be searched. Try again.'); } }
  },
  'drawer.save': async invocation => {
   if (busy.current) return;
   const item = readDraft(invocation); const url = customDrawerUrl(item.url);
   if (!item.title.trim()) { setError('Enter a title for this drawer item.'); return; }
   if (!url) { setError('Enter a relative URL or an absolute http:// or https:// URL without spaces or credentials.'); return; }
   const saved = { ...item, title: item.title.trim(), url, id: item.id || `custom-${crypto.randomUUID()}` };
   setDraft(item); busy.current = true; setSaving(true); setError('');
   try {
    await setCustomItems(item.id ? customItems.map(existing => existing.id === item.id ? saved : existing) : [...customItems, saved], invocation.signal);
    if (!invocation.signal.aborted) { busy.current = false; close(); }
   } catch { if (!invocation.signal.aborted) setError('The item could not be saved on this device. Your draft is kept. Please try again.'); }
   finally { busy.current = false; if (alive.current) setSaving(false); }
  },
  'drawer.navigate': ({ inputs }) => {
   const item = customItems.find(item => item.id === inputs.id); const url = customDrawerUrl(item?.url); if (!url || !item) return;
   const resolved = new URL(url, window.location.href);
   if (resolved.origin !== window.location.origin) window.location.assign(resolved.href); else navigate(`${resolved.pathname}${resolved.search}${resolved.hash}`);
   if (closesOnClick(item.id)) { setDrawerOpen(false); onNavigate?.(); }
  }
 };
 return <div ref={host}><SettingsDocumentHost documentKey={settings ? 'custom-drawer-settings' : 'custom-drawer-menu'} title="Custom drawer layout" layoutEditingDisabled={saving} defaultDocument={blocks} scopeKey={scopeKey} persistence="device">
  {({ blocks, chrome, editing }) => <TransientBlockHost key={editorGeneration} scopeKey={scopeKey} enabled={!editing} scope={{ drawer: {
   items: customItems.map(item => ({ ...item, closes: closesOnClick(item.id) })), open, draft, heading: draft.id ? 'Edit drawer item' : 'Add drawer item',
   attached: draft.thingId ? (draft.thingTitle ? `Attached Thing: ${draft.thingTitle}` : 'Thing attached') : '', query, results, error, searchMessage, saving, managementError, hasMore: !!nextCursor
  } }} actions={actions}>
   <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
  </TransientBlockHost>}
 </SettingsDocumentHost></div>;
}
