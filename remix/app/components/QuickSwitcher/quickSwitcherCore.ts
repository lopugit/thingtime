// Pure data layer for the ⌘K quick switcher: the static page catalog, the
// per-viewer recents cache, and the tiny title extraction used for thing rows.
// Kept apart from QuickSwitcher.tsx so the palette component stays a thin
// keyboard/render shell.

import { blocksToText, getEditorJsDoc } from '~/components/Editor/editorJsValue';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';

// One row the palette can highlight/navigate. `kind` picks the leading visual
// (emoji glyph for pages, avatar circle for people/things).
export type QuickRow = {
  key: string;
  kind: 'page' | 'person' | 'thing';
  label: string;
  sublabel?: string;
  href: string;
  glyph?: string;
  avatarUrl?: string | null;
};

export type QuickSection = {
  id: 'recent' | 'pages' | 'people' | 'things';
  title: string;
  rows: QuickRow[];
};

export const QUICK_SECTION_CAP = 5;

// Static page catalog — every path verified against remix/app/routes.tsx.
// `keywords` feed Fuse so "msgs" or "prefs" style queries still land.
export const QUICK_PAGES: (QuickRow & { keywords: string })[] = [
  { key: 'page:/feed', kind: 'page', label: 'Feed', href: '/feed', glyph: '📰', keywords: 'home posts timeline' },
  { key: 'page:/explore', kind: 'page', label: 'Explore', href: '/explore', glyph: '🧭', keywords: 'trending discover popular' },
  { key: 'page:/messages', kind: 'page', label: 'Messages', href: '/messages', glyph: '💬', keywords: 'messenger chats dm inbox' },
  { key: 'page:/things', kind: 'page', label: 'Things', href: '/things', glyph: '🗂️', keywords: 'drive files folders library' },
  { key: 'page:/search', kind: 'page', label: 'Search', href: '/search', glyph: '🔎', keywords: 'find query lookup' },
  { key: 'page:/themes', kind: 'page', label: 'Themes', href: '/themes', glyph: '🎨', keywords: 'appearance colors styling' },
  { key: 'page:/schemas', kind: 'page', label: 'Schemas', href: '/schemas', glyph: '🧬', keywords: 'shapes fields crystal types' },
  { key: 'page:/settings', kind: 'page', label: 'Settings', href: '/settings', glyph: '⚙️', keywords: 'account preferences tokens' },
  { key: 'page:/profile', kind: 'page', label: 'Profile', href: '/profile', glyph: '🌈', keywords: 'me my page account' },
  { key: 'page:/docs/api', kind: 'page', label: 'API docs', href: '/docs/api', glyph: '📚', keywords: 'reference endpoints developer documentation' }
];

// ——— recents ————————————————————————————————————————————————————————————
// Per-viewer, timestamped, capped — the empty-query "Recent" section. The key
// carries the viewer id so switching accounts never shows another viewer's
// jump history; useApi's logout sweeps the whole tt-quickswitch- prefix.

export type QuickRecent = QuickRow & { at: number };
type RecentsCacheShape = { at: number; items: QuickRecent[] };

export const QUICK_RECENTS_CAP = 8;
export const quickRecentsKey = (viewerId: string | null | undefined): string =>
  `tt-quickswitch-${viewerId || 'anon'}`;

export const readQuickRecents = (viewerId: string | null | undefined): QuickRecent[] => {
  const cached = readLocalCache<RecentsCacheShape>(quickRecentsKey(viewerId));
  if (!cached || !Array.isArray(cached.items)) return [];
  return cached.items.filter((item) => item && typeof item.href === 'string' && typeof item.label === 'string');
};

export const pushQuickRecent = (viewerId: string | null | undefined, row: QuickRow): QuickRecent[] => {
  const next: QuickRecent[] = [
    { ...row, at: Date.now() },
    // dedupe by destination — repicking a row just bumps it to the top
    ...readQuickRecents(viewerId).filter((item) => item.href !== row.href)
  ].slice(0, QUICK_RECENTS_CAP);
  writeLocalCache(quickRecentsKey(viewerId), { at: Date.now(), items: next } satisfies RecentsCacheShape);
  return next;
};

// ——— thing titling ———————————————————————————————————————————————————————
// Mirrors SearchPage's title fallback chain: post text, then crystal
// name/title/text — any of which may hold an Editor.js doc.

export const quickThingTitle = (crystal: Record<string, unknown> | null | undefined, postText?: string | null): string => {
  const candidates = [postText, crystal?.name, crystal?.title, crystal?.text];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.replace(/\s+/g, ' ').trim();
    const doc = getEditorJsDoc(candidate);
    if (doc) {
      const text = blocksToText(doc.blocks).replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
  }
  return 'Untitled thing';
};
