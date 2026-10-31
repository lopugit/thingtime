import React from 'react';

// Feed keyboard shortcuts (desktop nicety, frontend-only):
//   j / k — move focus down/up the post column (ring + scrollIntoView)
//   l     — toggle a ❤️ on the focused post (reuses PostCard's optimistic
//           handleReact — the exact handler the reaction picker calls)
//   c     — same as clicking the focused post's "Show comments" button
//   n     — focus the composer (feed only — pages opt in via onFocusComposer)
//   ?     — open the shortcuts cheatsheet (FeedShortcutsHelp)
//   Esc   — clear the focus ring
//
// The listener is deliberately INERT whenever the viewer is typing (input/
// textarea/select/contenteditable — the same activeElement-based detection
// CommanderV2's key listener uses), whenever any modal/popover/menu is open,
// or while Commander is active (its `#commander[data-commander-active]` DOM
// marker). Plain single letters only: any meta/ctrl/alt chord passes through
// untouched, and preventDefault fires only for keys we actually handled.
//
// Wiring is opt-in per page: mount the hook (feed + explore do), hand its
// `registry` to FeedShortcutsContext.Provider around the PostList, and pass
// `focusedPostId` to PostList for the ring. PostCards inside the provider
// register their own handleReact/toggleComments — the hook never reimplements
// reaction or comment logic, it just calls the card's own handlers.

export type FeedPostShortcutActions = {
  // PostCard's optimistic reaction toggle (handleReact) — token in, toggle out
  react: (token: string) => void;
  // PostCard's toggleComments — identical to the Show/Hide comments button
  toggleComments: () => void;
};

// cards register a REF so the hook always calls the freshest closures without
// re-registering on every render
export type FeedPostShortcutActionsRef = React.MutableRefObject<FeedPostShortcutActions | null>;

export type FeedShortcutsRegistry = {
  register: (postId: string, actions: FeedPostShortcutActionsRef) => () => void;
};

// Default null: PostCards outside a shortcuts-enabled page register nowhere
// and render exactly as before (profile, permalinks, messenger embeds).
export const FeedShortcutsContext = React.createContext<FeedShortcutsRegistry | null>(null);

// The house typing-context check (CommanderV2 keys off document.activeElement
// the same way): focus in any editable surface makes the shortcuts inert.
// Exported: the ⌘K QuickSwitcher shares these exact detections.
export const isTypingContext = (element: Element | null): boolean => {
  if (!element) return false;
  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return element instanceof HTMLElement && element.isContentEditable;
};

// computed-style check (NOT Element.checkVisibility, whose default options
// ignore `visibility: hidden` — exactly how Chakra parks closed popovers and
// menus in the DOM); computed visibility inherits from the hidden popper
// wrapper, so closed-but-mounted overlays read as invisible here
const isElementVisible = (element: Element): boolean => {
  if (element.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
};

// Any visible modal/popover/menu parks the shortcuts (Chakra renders them all
// with dialog/menu roles; closed non-lazy ones stay in the DOM but hidden).
export const hasOpenOverlay = (): boolean => {
  const nodes = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]');
  for (const node of Array.from(nodes)) {
    if (isElementVisible(node)) return true;
  }
  return false;
};

// Commander paints data-commander-active on its host — the same marker its
// own styling keys off — so an open Commander parks the shortcuts even when
// its input isn't the active element.
export const isCommanderActive = (): boolean => !!document.querySelector('#commander[data-commander-active="true"]');

const escapeCssId = (id: string): string =>
  typeof window !== 'undefined' && window.CSS?.escape ? window.CSS.escape(id) : id;

export type UseFeedShortcutsOptions = {
  // rendered post ids, in list order — focus moves through these
  postIds: string[];
  // feed passes a composer-focuser; pages without a composer just omit it
  onFocusComposer?: () => void;
};

export type UseFeedShortcutsResult = {
  focusedPostId: string | null;
  registry: FeedShortcutsRegistry;
  helpOpen: boolean;
  closeHelp: () => void;
};

export const useFeedShortcuts = (options: UseFeedShortcutsOptions): UseFeedShortcutsResult => {
  const { postIds, onFocusComposer } = options;

  const [focusedPostId, setFocusedPostId] = React.useState<string | null>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);

  const registryMapRef = React.useRef(new Map<string, FeedPostShortcutActionsRef>());
  // stable identity — context consumers (memoised PostCards) never re-render
  // because of the provider, and register/unregister survives focus moves
  const registry = React.useMemo<FeedShortcutsRegistry>(
    () => ({
      register: (postId, actions) => {
        registryMapRef.current.set(postId, actions);
        return () => {
          if (registryMapRef.current.get(postId) === actions) registryMapRef.current.delete(postId);
        };
      }
    }),
    []
  );

  // the keydown handler reads through a ref so the window listener binds once
  const stateRef = React.useRef({ postIds, focusedPostId, onFocusComposer });
  stateRef.current = { postIds, focusedPostId, onFocusComposer };

  React.useEffect(() => {
    // a post that left the list (deleted, refetch narrowed it away) drops its ring
    if (focusedPostId && !postIds.includes(focusedPostId)) setFocusedPostId(null);
  }, [postIds, focusedPostId]);

  React.useEffect(() => {
    const moveFocus = (delta: 1 | -1): boolean => {
      const { postIds: ids, focusedPostId: focused } = stateRef.current;
      if (!ids.length) return false;
      const current = focused ? ids.indexOf(focused) : -1;
      // no ring yet → j AND k both land on the first visible post; otherwise
      // step and clamp at the ends (top stays top, bottom stays bottom)
      const next = current === -1 ? 0 : Math.min(ids.length - 1, Math.max(0, current + delta));
      const id = ids[next];
      setFocusedPostId(id);
      document.querySelector(`[data-thing-id="${escapeCssId(id)}"]`)?.scrollIntoView({ block: 'nearest' });
      return true;
    };

    const withFocusedPost = (run: (actions: FeedPostShortcutActions) => void): boolean => {
      const { focusedPostId: focused } = stateRef.current;
      if (!focused) return false;
      const actions = registryMapRef.current.get(focused)?.current;
      if (!actions) return false;
      run(actions);
      return true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      // plain single letters only — chords belong to the browser/Commander
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingContext(document.activeElement)) return;
      if (isCommanderActive()) return;

      if (event.key === 'Escape') {
        // clear the ring — but never fight a modal/popover's own Escape
        if (!hasOpenOverlay() && stateRef.current.focusedPostId) setFocusedPostId(null);
        return;
      }

      // any open modal/popover/menu (including the cheatsheet itself) parks
      // the shortcuts — Chakra owns Escape/backdrop dismissal there
      if (hasOpenOverlay()) return;

      let handled = false;
      switch (event.key) {
        case 'j':
          handled = moveFocus(1);
          break;
        case 'k':
          handled = moveFocus(-1);
          break;
        case 'l':
          // ❤️ through the card's own optimistic handleReact — toggles on/off
          handled = withFocusedPost((actions) => actions.react('❤️'));
          break;
        case 'c':
          handled = withFocusedPost((actions) => actions.toggleComments());
          break;
        case 'n': {
          const focusComposer = stateRef.current.onFocusComposer;
          if (focusComposer) {
            focusComposer();
            handled = true;
          }
          break;
        }
        case '?':
          setHelpOpen(true);
          handled = true;
          break;
        default:
          break;
      }

      if (handled) event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const closeHelp = React.useCallback(() => setHelpOpen(false), []);

  return { focusedPostId, registry, helpOpen, closeHelp };
};
