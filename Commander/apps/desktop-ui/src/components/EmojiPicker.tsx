import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, ChevronDown, CornerDownLeft, Search, Smile, WandSparkles } from 'lucide-react';
import {
  extensionCommandItemId,
  type EmojiDefaultAction,
  type NativePasteResult,
  type Platform,
  type SearchHit,
} from '@commander/protocol';
import { beginWindowDrag, nativeBridgeAvailable, nativeRequest } from '../lib/nativeBridge.js';
import { ActionsPanel } from './ActionsPanel.js';
import {
  EMOJI_CATEGORIES,
  emojiValue,
  findEmojiEntries,
  type EmojiCategory,
  type EmojiEntry,
  type EmojiTone,
  unicodeNotation,
} from './emojiData.js';
import {
  learnedEmojiCounts,
  loadEmojiLearning,
  recordEmojiChoice,
  resetEmojiChoice,
  saveEmojiLearning,
} from './emojiLearning.js';

const RECENT_STORAGE_KEY = 'commander-emoji-recents-v1';
const TONE_STORAGE_KEY = 'commander-emoji-tone-v1';
const RECENT_LIMIT = 32;
const INITIAL_VISIBLE_LIMIT = 320;
const PAGE_SIZE = 240;
const GRID_COLUMNS = 8;
const COMMAND_ITEM_ID = extensionCommandItemId('builtin:emoji-symbols', 'search-emoji-symbols');

export function EmojiPicker({
  onBack,
  platform,
  defaultAction,
}: {
  onBack(): void;
  platform: Platform;
  defaultAction: EmojiDefaultAction;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null);
  const learnedSelectionID = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [category, setCategory] = useState<EmojiCategory>('all');
  const [recentIDs, setRecentIDs] = useState<string[]>(loadRecentIDs);
  const [learning, setLearning] = useState(loadEmojiLearning);
  const [tone, setTone] = useState<EmojiTone>(loadTone);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_LIMIT);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [targetApplication, setTargetApplication] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [requiresAccessibility, setRequiresAccessibility] = useState(false);
  const actionInFlight = useRef(false);

  const learnedCounts = useMemo(() => learnedEmojiCounts(learning, deferredQuery), [deferredQuery, learning]);
  const results = useMemo(
    () => findEmojiEntries(deferredQuery, category, recentIDs, learnedCounts),
    [category, deferredQuery, learnedCounts, recentIDs],
  );
  const visible = useMemo(() => results.slice(0, visibleLimit), [results, visibleLimit]);
  const selected = visible[selectedIndex] ?? visible[0];
  const selectedValue = selected ? emojiValue(selected, tone) : '';

  useEffect(() => {
    inputRef.current?.focus();
    void nativeRequest('launcher.commandReady', { itemId: COMMAND_ITEM_ID }).catch(() => undefined);
    void nativeRequest<{ name?: string }>('application.pasteTarget')
      .then((result) => setTargetApplication(result?.name?.trim() || null))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
    setVisibleLimit(INITIAL_VISIBLE_LIMIT);
    setActionsOpen(false);
  }, [category, deferredQuery]);

  useEffect(() => saveEmojiLearning(learning), [learning]);

  useEffect(() => {
    const selectedCell = document.querySelector<HTMLElement>('.emoji-cell.selected');
    if (typeof selectedCell?.scrollIntoView === 'function')
      selectedCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => {
    const emojiID = learnedSelectionID.current;
    if (!emojiID) return;
    const nextIndex = visible.findIndex((entry) => entry.id === emojiID);
    if (nextIndex >= 0) setSelectedIndex(nextIndex);
    learnedSelectionID.current = null;
  }, [visible]);

  const remember = useCallback((entry: EmojiEntry) => {
    setRecentIDs((current) => {
      const next = [entry.id, ...current.filter((id) => id !== entry.id)].slice(0, RECENT_LIMIT);
      saveLocal(RECENT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const learn = useCallback(
    (entry: EmojiEntry) => {
      if (!query.trim()) return;
      learnedSelectionID.current = entry.id;
      setLearning((current) => recordEmojiChoice(current, query, entry.id));
    },
    [query],
  );

  const runAction = useCallback(
    async (actionID: string, target: EmojiEntry | undefined = selected) => {
      if (!target || actionInFlight.current) return;
      const value = emojiValue(target, tone);
      if (actionID === 'reset-learning') {
        setRequiresAccessibility(false);
        setLearning((current) => resetEmojiChoice(current, query, target.id));
        setActionsOpen(false);
        setStatus(
          query.trim()
            ? `Reset ${value} learning for “${query.trim()}”`
            : 'Search for a phrase before resetting emoji learning',
        );
        return;
      }
      actionInFlight.current = true;
      setActionsOpen(false);
      const recordSuccess = () => {
        setRequiresAccessibility(false);
        setStatus(null);
        learnedSelectionID.current = target.id;
        remember(target);
        learn(target);
      };
      try {
        if (actionID === 'copy-unicode') {
          await writeClipboard(unicodeNotation(value));
          recordSuccess();
          setStatus(`Copied ${unicodeNotation(value)}`);
          return;
        }
        if (actionID === 'copy') {
          await writeClipboard(value);
          recordSuccess();
          setStatus(`${value} copied to the clipboard`);
          return;
        }
        const preserveClipboard = actionID === 'paste';
        const result = await nativeRequest<NativePasteResult>('clipboard.paste', {
          text: value,
          preserveClipboard,
        });
        if (!result) {
          if (preserveClipboard)
            throw new Error('Paste to the current app requires the Commander desktop host');
          await browserClipboard(value);
          recordSuccess();
          setStatus(`${value} copied to the clipboard`);
        } else if (!result.pasted) {
          // A rejected paste is not a choice: keep recents, ranking and selection
          // stable so retrying cannot silently select a different emoji.
          if (result.copied && !preserveClipboard) recordSuccess();
          setRequiresAccessibility(result.requiresAccessibility);
          setStatus(
            result.requiresAccessibility
              ? preserveClipboard
                ? `Commander needs Accessibility access to paste ${value}. Your clipboard is unchanged.`
                : result.copied
                  ? `${value} is copied. Commander needs Accessibility access to paste automatically.`
                  : `Commander needs Accessibility access to paste ${value}. It could not be copied.`
              : preserveClipboard
                ? `${value} could not be pasted`
                : result.copied
                  ? `${value} copied to the clipboard`
                  : `${value} could not be pasted or copied`,
          );
        } else {
          recordSuccess();
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not use that emoji');
      } finally {
        actionInFlight.current = false;
      }
    },
    [learn, query, remember, selected, tone],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (actionsOpen && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (actionsOpen) setActionsOpen(false);
        else onBack();
        return;
      }
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (selected) setActionsOpen((current) => !current);
        return;
      }
      if (event.key === 'Enter' && event.metaKey) {
        event.preventDefault();
        void runAction('copy');
        return;
      }
      if (event.key.toLowerCase() === 'c' && event.metaKey && event.shiftKey) {
        event.preventDefault();
        void runAction('copy-unicode');
        return;
      }
      if (event.key === 'Enter' && selected) {
        event.preventDefault();
        void runAction(defaultAction);
        return;
      }
      const maximum = Math.max(0, visible.length - 1);
      let next = selectedIndex;
      if (event.key === 'ArrowRight') next += 1;
      else if (event.key === 'ArrowLeft') next -= 1;
      else if (event.key === 'ArrowDown') next += GRID_COLUMNS;
      else if (event.key === 'ArrowUp') next -= GRID_COLUMNS;
      else return;
      event.preventDefault();
      setSelectedIndex(Math.min(maximum, Math.max(0, next)));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actionsOpen, defaultAction, onBack, runAction, selected, selectedIndex, visible.length]);

  const actionItem = useMemo<SearchHit | undefined>(() => {
    if (!selected) return undefined;
    return {
      id: selected.id,
      title: selected.label,
      subtitle: unicodeNotation(selectedValue),
      kind: 'command',
      keywords: [...selected.keywords],
      favourite: false,
      actions: [
        { id: 'paste', title: `Paste ${selectedValue} (Keep Clipboard)`, shortcut: '↵' },
        { id: 'paste-and-copy', title: 'Paste and Keep on Clipboard' },
        { id: 'copy', title: 'Copy to Clipboard', shortcut: '⌘↵' },
        { id: 'copy-unicode', title: 'Copy Unicode Code Points', shortcut: '⇧⌘C' },
        ...(deferredQuery.trim()
          ? [
              {
                id: 'reset-learning',
                title: `Reset learned score for “${deferredQuery.trim()}”`,
              },
            ]
          : []),
      ],
      score: 0,
      matchedRanges: [],
    };
  }, [deferredQuery, selected, selectedValue]);

  const selectFromPointer = useCallback((index: number, event: ReactPointerEvent<HTMLElement>) => {
    const previous = lastPointerPosition.current;
    if (previous && previous.x === event.clientX && previous.y === event.clientY) return;
    lastPointerPosition.current = { x: event.clientX, y: event.clientY };
    setSelectedIndex(index);
  }, []);

  return (
    <main className="launcher-shell">
      <section className="launcher-panel emoji-picker-panel" aria-label="Search Emoji & Symbols">
        <header className="emoji-toolbar" onMouseDown={beginWindowDrag}>
          <button type="button" className="emoji-back" aria-label="Back to Commander" onClick={onBack}>
            <ArrowLeft />
          </button>
          <label className="emoji-search">
            <Search aria-hidden="true" />
            <input
              ref={inputRef}
              aria-label="Search emoji and symbols"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              placeholder="Search emoji and symbols…"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                const selectsAll = event.metaKey || (event.ctrlKey && platform !== 'macos');
                if (event.key.toLowerCase() === 'a' && selectsAll) {
                  event.preventDefault();
                  event.currentTarget.select();
                }
              }}
            />
          </label>
          <label className="emoji-select-wrap">
            <span className="sr-only">Emoji category</span>
            <select
              aria-label="Emoji category"
              value={category}
              onChange={(event) => setCategory(event.target.value as EmojiCategory)}
            >
              {EMOJI_CATEGORIES.map((candidate) => (
                <option
                  key={candidate.id}
                  value={candidate.id}
                  disabled={candidate.id === 'recent' && !recentIDs.length}
                >
                  {candidate.label}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
          <label className="emoji-select-wrap tone-select-wrap">
            <span className="sr-only">Default skin tone</span>
            <select
              aria-label="Default skin tone"
              value={tone}
              onChange={(event) => {
                const next = Number(event.target.value) as EmojiTone;
                setTone(next);
                saveLocal(TONE_STORAGE_KEY, String(next));
              }}
            >
              <option value={0}>Default</option>
              <option value={1}>🏻</option>
              <option value={2}>🏼</option>
              <option value={3}>🏽</option>
              <option value={4}>🏾</option>
              <option value={5}>🏿</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
        </header>

        <section className="emoji-results">
          <div className="section-heading emoji-heading">
            <span role="heading" aria-level={2}>
              Results
            </span>
            <span>{results.length}</span>
          </div>
          {visible.length ? (
            <div className="emoji-grid" role="listbox" aria-label="Emoji and symbol results">
              {visible.map((entry, index) => {
                const value = emojiValue(entry, tone);
                const isSelected = index === selectedIndex;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-label={`${entry.label}, ${unicodeNotation(value)}`}
                    aria-selected={isSelected}
                    className={isSelected ? 'emoji-cell selected' : 'emoji-cell'}
                    key={entry.id}
                    title={entry.label}
                    onPointerMove={(event) => selectFromPointer(index, event)}
                    onClick={() => setSelectedIndex(index)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelectedIndex(index);
                      setActionsOpen(true);
                    }}
                    onDoubleClick={() => void runAction(defaultAction, entry)}
                  >
                    <span>{value}</span>
                  </button>
                );
              })}
              {visible.length < results.length ? (
                <button
                  type="button"
                  className="emoji-show-more"
                  onClick={() => setVisibleLimit((current) => current + PAGE_SIZE)}
                >
                  Show {Math.min(PAGE_SIZE, results.length - visible.length)} more
                </button>
              ) : null}
            </div>
          ) : (
            <div className="emoji-empty">
              <WandSparkles />
              <strong>No emoji or symbols found</strong>
              <span>Try a feeling, object, symbol name, or Unicode code point.</span>
            </div>
          )}
        </section>

        <footer className="emoji-footer">
          <span className="emoji-footer-icon" aria-hidden="true">
            <Smile />
          </span>
          <span className="emoji-footer-selection">
            {selected ? `${selectedValue}  ${titleCase(selected.label)}` : 'Search Emoji & Symbols'}
          </span>
          <span className="footer-spacer" />
          <span className="emoji-primary-action">
            {emojiActionLabel(defaultAction, targetApplication)} <kbd>↵</kbd>
          </span>
          <span className="footer-divider" />
          <span>Actions</span>
          <kbd>⌘ K</kbd>
          {status ? (
            <div className="emoji-feedback">
              <span className="emoji-status" role="status">
                {status}
              </span>
              {requiresAccessibility ? (
                <>
                  <span className="emoji-permission-help">
                    Enable Commander in Privacy &amp; Security → Accessibility. If it is already enabled,
                    switch Commander off and on, then quit and reopen Commander.
                  </span>
                  <div className="emoji-recovery-actions">
                    <button
                      type="button"
                      onClick={() => {
                        void nativeRequest('application.open', {
                          path: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
                        }).catch(() =>
                          setStatus('Could not open Accessibility settings. Open System Settings manually.'),
                        );
                      }}
                    >
                      Open Accessibility Settings
                    </button>
                    <button type="button" onClick={() => void runAction('copy')}>
                      Copy Emoji
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </footer>

        {actionsOpen && actionItem ? (
          <ActionsPanel item={actionItem} onAction={(id) => void runAction(id)} />
        ) : null}
      </section>
    </main>
  );
}

function emojiActionLabel(action: EmojiDefaultAction, targetApplication: string | null): string {
  if (action === 'copy') return 'Copy to Clipboard';
  if (action === 'copy-unicode') return 'Copy Unicode';
  const target = targetApplication ? ` to ${targetApplication}` : '';
  return action === 'paste' ? `Paste${target}` : `Paste & Copy${target}`;
}

async function writeClipboard(value: string): Promise<void> {
  if (nativeBridgeAvailable()) {
    await nativeRequest('clipboard.write', { text: value });
    return;
  }
  await browserClipboard(value);
}

async function browserClipboard(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable');
  await navigator.clipboard.writeText(value);
}

function loadRecentIDs(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function loadTone(): EmojiTone {
  try {
    const value = Number(window.localStorage.getItem(TONE_STORAGE_KEY) ?? '0');
    return value >= 0 && value <= 5 ? (value as EmojiTone) : 0;
  } catch {
    return 0;
  }
}

function saveLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The picker remains fully usable when durable browser storage is unavailable.
  }
}

function titleCase(value: string): string {
  return value.replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toUpperCase());
}
