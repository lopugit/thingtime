// The full emoji keyboard dataset (~1900 emoji in 9 groups), loaded lazily so
// it only ships when the picker first opens. We store/render the native unicode
// characters directly — no image sprites, no CDN — so every platform draws its
// own emoji. Source: unicode-emoji-json (data only), grouped + name-searchable.

export type EmojiEntry = { emoji: string; name: string; keywords: string };
export type EmojiGroup = { name: string; slug: string; emojis: EmojiEntry[] };
export type EmojiData = { groups: EmojiGroup[]; all: EmojiEntry[] };

type RawGroup = {
  name: string;
  slug: string;
  emojis: Array<{ emoji: string; name: string; slug: string }>;
};

let dataPromise: Promise<EmojiData> | null = null;

// Module-level memo so the dataset chunk is fetched + parsed once per session.
export const loadEmojiData = (): Promise<EmojiData> => {
  if (!dataPromise) {
    dataPromise = import('unicode-emoji-json/data-by-group.json')
      .then((mod) => {
        const raw = ((mod as any).default ?? mod) as RawGroup[];
        const groups: EmojiGroup[] = raw.map((group) => ({
          name: group.name,
          slug: group.slug,
          emojis: group.emojis.map((entry) => ({
            emoji: entry.emoji,
            name: entry.name,
            keywords: `${entry.name} ${entry.slug.replace(/_/g, ' ')}`.toLowerCase()
          }))
        }));
        return { groups, all: groups.flatMap((group) => group.emojis) };
      })
      .catch((err) => {
        // let the next open retry rather than caching a failed load
        dataPromise = null;
        throw err;
      });
  }
  return dataPromise;
};

// Name/keyword search: prefix-name matches first, then keyword-contains.
export const searchEmojis = (all: EmojiEntry[], query: string, limit = 80): EmojiEntry[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: EmojiEntry[] = [];
  const contains: EmojiEntry[] = [];
  for (const entry of all) {
    if (entry.name.startsWith(q)) starts.push(entry);
    else if (entry.keywords.includes(q)) contains.push(entry);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
};

// Short labels for the category tab strip (keyed by group slug).
export const GROUP_TAB_EMOJI: Record<string, string> = {
  smileys_emotion: '😀',
  people_body: '👋',
  animals_nature: '🐻',
  food_drink: '🍔',
  travel_places: '✈️',
  activities: '⚽',
  objects: '💡',
  symbols: '❤️',
  flags: '🏳️'
};
