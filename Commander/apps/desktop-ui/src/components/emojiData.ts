import emojiData from 'emojibase-data/en/data.json';

export type EmojiCategory = 'all' | 'recent' | '0' | '1' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type EmojiTone = 0 | 1 | 2 | 3 | 4 | 5;

interface RawEmojiSkin {
  emoji: string;
  hexcode: string;
  label: string;
  tone: number;
}

interface RawEmoji {
  emoji: string;
  emoticon?: string;
  group?: number;
  hexcode: string;
  label: string;
  order?: number;
  skins?: RawEmojiSkin[];
  tags?: string[];
}

export interface EmojiEntry {
  id: string;
  value: string;
  label: string;
  category: Exclude<EmojiCategory, 'all' | 'recent'>;
  order: number;
  keywords: readonly string[];
  searchText: string;
  skins: ReadonlyArray<{ value: string; tone: EmojiTone }>;
}

export const EMOJI_CATEGORIES: ReadonlyArray<{ id: EmojiCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'recent', label: 'Recently Used' },
  { id: '0', label: 'Smileys & Emotion' },
  { id: '1', label: 'People & Body' },
  { id: '3', label: 'Animals & Nature' },
  { id: '4', label: 'Food & Drink' },
  { id: '5', label: 'Travel & Places' },
  { id: '6', label: 'Activities' },
  { id: '7', label: 'Objects' },
  { id: '8', label: 'Symbols' },
  { id: '9', label: 'Flags' },
];

const EXTRA_SYMBOLS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['←', 'left arrow', ['back', 'previous', 'west']],
  ['↑', 'up arrow', ['north', 'top']],
  ['→', 'right arrow', ['forward', 'next', 'east']],
  ['↓', 'down arrow', ['south', 'bottom']],
  ['↔', 'left right arrow', ['horizontal']],
  ['↕', 'up down arrow', ['vertical']],
  ['↖', 'up-left arrow', ['northwest']],
  ['↗', 'up-right arrow', ['northeast']],
  ['↘', 'down-right arrow', ['southeast']],
  ['↙', 'down-left arrow', ['southwest']],
  ['↩', 'return arrow', ['enter', 'return', 'keyboard']],
  ['↪', 'forward return arrow', ['redo', 'keyboard']],
  ['⇥', 'tab key', ['keyboard', 'indent']],
  ['⇧', 'shift key', ['keyboard', 'uppercase']],
  ['⌘', 'command key', ['keyboard', 'mac', 'apple']],
  ['⌥', 'option key', ['keyboard', 'alt', 'mac']],
  ['⌃', 'control key', ['keyboard', 'ctrl', 'mac']],
  ['⌫', 'delete key', ['keyboard', 'backspace']],
  ['⎋', 'escape key', ['keyboard', 'esc']],
  ['±', 'plus minus', ['math', 'positive', 'negative']],
  ['×', 'multiplication sign', ['math', 'times', 'multiply']],
  ['÷', 'division sign', ['math', 'divide']],
  ['≠', 'not equal', ['math', 'inequality']],
  ['≈', 'approximately equal', ['math', 'almost']],
  ['≤', 'less than or equal', ['math', 'inequality']],
  ['≥', 'greater than or equal', ['math', 'inequality']],
  ['∞', 'infinity', ['math', 'forever', 'endless']],
  ['√', 'square root', ['math', 'radical']],
  ['∑', 'summation', ['math', 'sum', 'sigma']],
  ['∏', 'product', ['math', 'pi']],
  ['∫', 'integral', ['math', 'calculus']],
  ['∆', 'delta', ['math', 'change', 'triangle']],
  ['π', 'pi', ['math', 'circle']],
  ['€', 'euro sign', ['currency', 'money']],
  ['£', 'pound sign', ['currency', 'money', 'sterling']],
  ['¥', 'yen sign', ['currency', 'money', 'yuan']],
  ['₹', 'rupee sign', ['currency', 'money', 'india']],
  ['₿', 'bitcoin sign', ['currency', 'money', 'crypto']],
  ['©', 'copyright sign', ['legal', 'rights']],
  ['®', 'registered sign', ['legal', 'trademark']],
  ['™', 'trademark sign', ['legal', 'brand']],
  ['°', 'degree sign', ['temperature', 'angle']],
  ['•', 'bullet', ['list', 'dot']],
  ['…', 'ellipsis', ['dots', 'more']],
  ['§', 'section sign', ['legal', 'paragraph']],
  ['¶', 'pilcrow', ['paragraph', 'formatting']],
  ['✓', 'check mark', ['tick', 'done', 'yes']],
  ['✕', 'multiplication x', ['close', 'cancel', 'no']],
  ['★', 'black star', ['favorite', 'rating']],
  ['☆', 'white star', ['favorite', 'rating', 'outline']],
];

function normalized(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function entryFromRaw(raw: RawEmoji): EmojiEntry | undefined {
  if (!raw.emoji || raw.group === undefined || raw.group === 2) return undefined;
  const category = String(raw.group) as EmojiEntry['category'];
  if (!EMOJI_CATEGORIES.some((candidate) => candidate.id === category)) return undefined;
  const keywords = [raw.label, ...(raw.tags ?? []), raw.emoticon ?? '', raw.hexcode].filter(Boolean);
  return {
    id: `emoji:${raw.hexcode}`,
    value: raw.emoji,
    label: raw.label,
    category,
    order: raw.order ?? Number.MAX_SAFE_INTEGER,
    keywords,
    searchText: normalized(keywords.join(' ')),
    skins: (raw.skins ?? []).flatMap((skin) =>
      skin.tone >= 1 && skin.tone <= 5 ? [{ value: skin.emoji, tone: skin.tone as EmojiTone }] : [],
    ),
  };
}

const entries = (emojiData as unknown as RawEmoji[])
  .flatMap((raw) => {
    const entry = entryFromRaw(raw);
    return entry ? [entry] : [];
  })
  .sort((left, right) => left.order - right.order);

const seenValues = new Set(entries.map((entry) => entry.value));
for (const [value, label, tags] of EXTRA_SYMBOLS) {
  if (seenValues.has(value)) continue;
  const hexcode = unicodeNotation(value).replaceAll('U+', '').replaceAll(' ', '-');
  const keywords = [label, ...tags];
  entries.push({
    id: `symbol:${hexcode}`,
    value,
    label,
    category: '8',
    order: 100_000 + entries.length,
    keywords,
    searchText: normalized(keywords.join(' ')),
    skins: [],
  });
}

export const EMOJI_ENTRIES: readonly EmojiEntry[] = entries;
const EMOJI_BY_ID = new Map(entries.map((entry) => [entry.id, entry]));

export function emojiValue(entry: EmojiEntry, tone: EmojiTone): string {
  return tone === 0 ? entry.value : (entry.skins.find((skin) => skin.tone === tone)?.value ?? entry.value);
}

export function unicodeNotation(value: string): string {
  return [...value]
    .map((character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
}

export function findEmojiEntries(
  query: string,
  category: EmojiCategory,
  recentIDs: readonly string[],
): EmojiEntry[] {
  const recent = recentIDs.flatMap((id) => {
    const entry = EMOJI_BY_ID.get(id);
    return entry ? [entry] : [];
  });
  const normalizedQuery = normalized(query.trim());
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const categoryMatches = (entry: EmojiEntry) =>
    category === 'all' || category === 'recent' || entry.category === category;

  if (!normalizedQuery) {
    if (category === 'recent') return recent;
    const filtered = entries.filter(categoryMatches);
    if (category !== 'all' || recent.length === 0) return filtered;
    const recentSet = new Set(recent.map((entry) => entry.id));
    return [...recent, ...filtered.filter((entry) => !recentSet.has(entry.id))];
  }

  return entries
    .filter((entry) => categoryMatches(entry) && terms.every((term) => entry.searchText.includes(term)))
    .map((entry) => ({ entry, score: matchScore(entry, normalizedQuery) }))
    .sort((left, right) => right.score - left.score || left.entry.order - right.entry.order)
    .map(({ entry }) => entry);
}

function matchScore(entry: EmojiEntry, query: string): number {
  const label = normalized(entry.label);
  if (label === query) return 10_000;
  if (label.startsWith(query)) return 8_000;
  if (entry.keywords.some((keyword) => normalized(keyword) === query)) return 7_000;
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 6_000;
  if (label.includes(query)) return 5_000;
  return 1_000;
}
