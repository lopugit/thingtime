import React from 'react';
import { Box, Center, Flex, Text } from '@chakra-ui/react';
import Fuse from 'fuse.js';
import { useNavigate } from 'react-router';

import type { SearchPerson, SearchThing, SearchPost } from '~/components/Search/searchTypes';
import { hasOpenOverlay, isCommanderActive } from '~/hooks/useFeedShortcuts';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';
import { getUserDisplayName } from '~/utils/userIdentity';
import {
  QUICK_PAGES,
  QUICK_SECTION_CAP,
  pushQuickRecent,
  quickThingTitle,
  readQuickRecents,
  type QuickRow,
  type QuickSection
} from './quickSwitcherCore';

// ⌘K / Ctrl+K site-wide quick switcher — jump to pages, people, and your own
// things from anywhere. Mounted once in root.tsx beside Nav.
//
// Hotkey model (deliberately mirrors useFeedShortcuts' inertness rules, except
// that a palette chord IS allowed while typing — standard ⌘K behavior):
//   · ⌘K (macOS) / Ctrl+K (elsewhere) toggles, even with focus in an
//     input/textarea/contenteditable. On macOS, Ctrl+K stays the system
//     kill-to-end-of-line editing command, so only ⌘ qualifies there.
//   · …but never while Commander is active (its data-commander-active marker),
//     while another modal/menu is open (hasOpenOverlay), when a listener
//     upstream already claimed the keystroke (event.defaultPrevented), or
//     inside an Editor.js redactor (.codex-editor) — Editor.js binds CMD+K
//     (Command AND Ctrl) for its core inline Link tool in every
//     LongTextEditor, and its role-less inline toolbar is invisible to
//     hasOpenOverlay.
//   · While open: ArrowUp/Down move the highlight across sections, Enter
//     navigates client-side, Escape/backdrop/⌘K closes. Escape is also
//     handled at the window level so the aria-modal dialog dismisses even if
//     the input lost focus; closing restores focus to the previously focused
//     element.
//
// The panel renders role="dialog", so useFeedShortcuts' overlay detection
// parks feed shortcuts (j/k/l/c) while the palette is up — typing here can
// never react to or scroll the feed underneath.
//
// Nav's 🔎⌘ button (mobile affordance) dispatches this event to open us:
export const QUICK_SWITCHER_TOGGLE_EVENT = 'thingtime:quick-switcher-toggle';
export const toggleQuickSwitcher = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(QUICK_SWITCHER_TOGGLE_EVENT));
};

const DEBOUNCE_MS = 200;

// On macOS Ctrl+K is the Cocoa kill-to-end-of-line editing command in every
// text field — the palette chord must require ⌘ there (same platform sniff as
// EditorSplit's modifier hint).
const IS_MAC_LIKE = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/i.test(navigator.platform || '');

type PeopleSearchResponse = { ok: boolean; users?: SearchPerson[] };
type ThingsSearchResponse = { ok: boolean; things?: SearchThing[]; posts?: Record<string, SearchPost> };

const personRow = (person: SearchPerson): QuickRow => ({
  key: `person:${person.username}`,
  kind: 'person',
  label: getUserDisplayName(person),
  sublabel: `@${person.username}`,
  href: `/profile/${encodeURIComponent(person.username)}`,
  avatarUrl: person.avatarUrl
});

const thingRow = (thing: SearchThing, posts: Record<string, SearchPost>): QuickRow => ({
  key: `thing:${thing.id}`,
  kind: 'thing',
  label: quickThingTitle(thing.crystal, posts[thing.id]?.text),
  sublabel: thing.thingtime.join(', ') || 'thing',
  href: `/thing/${encodeURIComponent(thing.id)}`,
  glyph: '💎'
});

const RowGlyph = ({ row }: { row: QuickRow }) => (
  <Center
    background="var(--tt-surface-alt, #f5f5f7)"
    borderRadius={row.kind === 'person' ? 'full' : '8px'}
    flexShrink={0}
    height="28px"
    overflow="hidden"
    width="28px"
  >
    {row.kind === 'person' && row.avatarUrl ? (
      <img alt="" src={row.avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    ) : (
      <Text fontSize="sm" lineHeight={1}>
        {row.glyph || row.label.slice(0, 1).toUpperCase()}
      </Text>
    )}
  </Center>
);

export const QuickSwitcher = () => {
  const api = useApi();
  const user = useCurrentUser();
  const navigate = useNavigate();

  // temporary bootstrap users have no meaningful "your things" — same
  // claimed-user bar Nav uses for its logged-in affordances
  const claimedUser = user?.temporary ? null : user;
  const viewerId = user?.id || null;

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [highlight, setHighlight] = React.useState(0);
  const [people, setPeople] = React.useState<QuickRow[]>([]);
  const [things, setThings] = React.useState<QuickRow[]>([]);
  const [recents, setRecents] = React.useState<QuickRow[]>([]);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const openRef = React.useRef(open);
  openRef.current = open;

  const apiRef = React.useRef(api);
  apiRef.current = api;

  // monotonic guard for the debounced searches — bumped on every new query,
  // on query clear, and on palette open so late responses for abandoned
  // queries can never repopulate state
  const searchSeq = React.useRef(0);

  // element focused before the palette opened — focus returns there on close
  // (dialog focus contract; also keeps a mid-composer user's typing flowing)
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);

  const fuse = React.useMemo(
    () =>
      new Fuse(QUICK_PAGES, {
        keys: [
          { name: 'label', weight: 2 },
          { name: 'keywords', weight: 1 }
        ],
        threshold: 0.38,
        ignoreLocation: true
      }),
    []
  );

  const openPalette = React.useCallback(() => {
    searchSeq.current += 1; // invalidate any in-flight search from a prior open
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setPeople([]);
    setThings([]);
    setHighlight(0);
    // recents seed synchronously from localCache — last-known state, no flash
    setRecents(readQuickRecents(viewerId));
    setOpen(true);
  }, [viewerId]);

  const closePalette = React.useCallback(() => setOpen(false), []);

  // ——— global hotkey + Nav-button event ————————————————————————————————
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      // Escape closes no matter where focus ended up — the input's own
      // handler covers the common case (and stops propagation), but focus
      // can be stolen from an aria-modal dialog, and Escape must still work
      if (event.key === 'Escape' && openRef.current) {
        event.preventDefault();
        setOpen(false);
        return;
      }
      // a listener upstream already claimed this keystroke (Editor.js
      // preventDefaults its CMD+K inline-Link binding, which still bubbles
      // to window) — never double-fire on a handled chord
      if (event.defaultPrevented) return;
      const modifierOk = IS_MAC_LIKE
        ? event.metaKey && !event.ctrlKey // Ctrl+K on macOS = kill-to-end-of-line, leave it to the text system
        : event.ctrlKey && !event.metaKey;
      const chord = modifierOk && !event.altKey && !event.shiftKey && event.code === 'KeyK';
      if (!chord) return;
      if (openRef.current) {
        event.preventDefault();
        setOpen(false);
        return;
      }
      // closed → deliberately allowed in typing contexts (standard palette
      // UX), but never over Commander or another open modal/menu, and never
      // inside an Editor.js redactor — Editor.js owns ⌘K there and its
      // role-less inline toolbar is invisible to hasOpenOverlay
      if ((event.target as Element | null)?.closest?.('.codex-editor')) return;
      if (isCommanderActive() || hasOpenOverlay()) return;
      event.preventDefault();
      openPalette();
    };

    const onToggle = () => {
      if (openRef.current) {
        setOpen(false);
        return;
      }
      if (isCommanderActive() || hasOpenOverlay()) return;
      openPalette();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(QUICK_SWITCHER_TOGGLE_EVENT, onToggle);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(QUICK_SWITCHER_TOGGLE_EVENT, onToggle);
    };
  }, [openPalette]);

  React.useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      // Editor.js restores its own selection after our synchronous focus —
      // re-assert on the next frame so the palette input owns the keyboard
      const raf = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(raf);
    }
    // closing (Escape, Enter-pick, backdrop, ⌘K): hand focus back to where
    // the user was, if that element still exists — never strand it on <body>
    const previous = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (previous?.isConnected) previous.focus();
    return undefined;
  }, [open]);

  // ——— debounced people + own-things search ————————————————————————————
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      // invalidate any in-flight response for the abandoned query — a late
      // response would otherwise pass the seq guard and resurface its stale
      // rows under whatever is typed next
      searchSeq.current += 1;
      setPeople([]);
      setThings([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(async () => {
      // people — GET /api/v1/users/search (public profile projections)
      apiRef.current.v1.profile
        .search({ q, limit: QUICK_SECTION_CAP })
        .then((resp: PeopleSearchResponse) => {
          if (searchSeq.current !== seq || !resp?.ok) return;
          setPeople((resp.users || []).slice(0, QUICK_SECTION_CAP).map(personRow));
        })
        .catch(() => {
          // palette is a nicety — degrade silently, keep prior rows
        });
      // your things — POST /api/v1/things/search fenced to the viewer via the
      // author shortcut filter (own username → ownerId server-side)
      if (claimedUser?.username) {
        apiRef.current.v1.things
          .search({ q, author: claimedUser.username, limit: QUICK_SECTION_CAP })
          .then((resp: ThingsSearchResponse) => {
            if (searchSeq.current !== seq || !resp?.ok) return;
            const posts = resp.posts || {};
            setThings((resp.things || []).slice(0, QUICK_SECTION_CAP).map((thing) => thingRow(thing, posts)));
          })
          .catch(() => {
            // same silent degrade
          });
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query, claimedUser?.username]);

  // ——— sections + flattened row list ———————————————————————————————————
  const sections = React.useMemo<QuickSection[]>(() => {
    const q = query.trim();
    if (!q) {
      const built: QuickSection[] = [];
      if (recents.length) built.push({ id: 'recent', title: 'Recent', rows: recents.slice(0, QUICK_SECTION_CAP) });
      built.push({ id: 'pages', title: 'Pages', rows: QUICK_PAGES.slice(0, QUICK_SECTION_CAP) });
      return built;
    }
    const built: QuickSection[] = [];
    const pageHits = fuse
      .search(q)
      .slice(0, QUICK_SECTION_CAP)
      .map((hit) => hit.item as QuickRow);
    if (pageHits.length) built.push({ id: 'pages', title: 'Pages', rows: pageHits });
    if (people.length) built.push({ id: 'people', title: 'People', rows: people });
    if (things.length) built.push({ id: 'things', title: 'Your things', rows: things });
    return built;
  }, [query, recents, fuse, people, things]);

  const flatRows = React.useMemo(() => sections.flatMap((section) => section.rows), [sections]);

  React.useEffect(() => {
    // results shifted under the highlight — clamp it back into range
    setHighlight((current) => Math.min(current, Math.max(0, flatRows.length - 1)));
  }, [flatRows.length]);

  const pick = React.useCallback(
    (row: QuickRow) => {
      setRecents(pushQuickRecent(viewerId, row));
      setOpen(false);
      navigate(row.href);
    },
    [viewerId, navigate]
  );

  const onInputKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePalette();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!flatRows.length) return;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = (highlight + delta + flatRows.length) % flatRows.length;
        setHighlight(next);
        listRef.current
          ?.querySelector(`[data-quick-row="${next}"]`)
          ?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const row = flatRows[highlight];
        if (row) pick(row);
        return;
      }
      // single-input focus trap — Tab has nowhere meaningful to go
      if (event.key === 'Tab') event.preventDefault();
    },
    [closePalette, flatRows, highlight, pick]
  );

  if (!open) return null;

  let rowIndex = -1;
  return (
    <Flex
      aria-label="Quick switcher"
      aria-modal="true"
      role="dialog"
      alignItems="flex-start"
      justifyContent="center"
      position="fixed"
      inset={0}
      zIndex={12000}
      background="color-mix(in srgb, var(--tt-text, #33333c) 26%, transparent)"
      paddingTop={['14vh', '18vh']}
      paddingX="16px"
      onMouseDown={(event) => {
        // backdrop closes; clicks inside the panel stop propagation below
        if (event.target === event.currentTarget) closePalette();
      }}
    >
      <Box
        {...CARD_STYLES}
        maxWidth="560px"
        width="100%"
        overflow="hidden"
        onMouseDown={(event) => {
          event.stopPropagation();
          // clicking non-interactive chrome (section headers, footer hints,
          // row backgrounds) must not blur the input — Escape/arrows/typing
          // keep working. Rows navigate via onClick, which still fires. The
          // input itself keeps native mousedown for caret placement.
          if (!(event.target as Element)?.closest?.('input')) event.preventDefault();
        }}
      >
        <Flex align="center" borderBottom="1px solid var(--tt-border, #ececef)" gap={2} paddingX={4} paddingY={3}>
          <Text aria-hidden="true" fontSize="sm" opacity={0.6}>
            🔎
          </Text>
          <input
            ref={inputRef}
            aria-label="Jump to pages, people, and your things"
            placeholder="Jump to a page, person, or thing…"
            value={query}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              width: '100%',
              fontSize: '15px',
              color: 'var(--tt-text, #33333c)'
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          <Text color="var(--tt-muted, #9a9aa6)" flexShrink={0} fontFamily="mono" fontSize="xs">
            esc
          </Text>
        </Flex>
        <Box ref={listRef} maxHeight="min(52vh, 420px)" overflowY="auto" paddingY={1}>
          {flatRows.length === 0 ? (
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm" paddingX={4} paddingY={4}>
              {query.trim() ? 'Nothing matched — keep typing?' : 'Type to search pages, people, and your things.'}
            </Text>
          ) : (
            sections.map((section) => (
              <Box key={section.id} paddingBottom={1}>
                <Text
                  color="var(--tt-muted, #9a9aa6)"
                  fontSize="0.68rem"
                  fontWeight="700"
                  letterSpacing="0.06em"
                  paddingTop={2}
                  paddingX={4}
                  textTransform="uppercase"
                >
                  {section.title}
                </Text>
                {section.rows.map((row) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  const active = index === highlight;
                  return (
                    <Flex
                      key={`${section.id}:${row.key}`}
                      align="center"
                      background={active ? 'var(--tt-surface-hover, #ececee)' : 'transparent'}
                      cursor="pointer"
                      data-quick-row={index}
                      gap={3}
                      paddingX={4}
                      paddingY={2}
                      onClick={() => pick(row)}
                      onMouseMove={() => {
                        if (highlight !== index) setHighlight(index);
                      }}
                    >
                      <RowGlyph row={row} />
                      <Box minWidth={0}>
                        <Text color="var(--tt-text, #33333c)" fontSize="sm" fontWeight="600" isTruncated>
                          {row.label}
                        </Text>
                        {row.sublabel ? (
                          <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" isTruncated>
                            {row.sublabel}
                          </Text>
                        ) : null}
                      </Box>
                      <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" marginLeft="auto">
                        {active ? '↵' : ''}
                      </Text>
                    </Flex>
                  );
                })}
              </Box>
            ))
          )}
        </Box>
        <Flex
          borderTop="1px solid var(--tt-border, #ececef)"
          color="var(--tt-muted, #9a9aa6)"
          fontSize="xs"
          gap={3}
          paddingX={4}
          paddingY={2}
        >
          <Text>↑↓ navigate</Text>
          <Text>↵ open</Text>
          <Text marginLeft="auto">⌘K</Text>
        </Flex>
      </Box>
    </Flex>
  );
};
