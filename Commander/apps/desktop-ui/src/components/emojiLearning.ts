import { normalizeEmojiQuery } from './emojiData.js';

export const EMOJI_LEARNING_STORAGE_KEY = 'commander-emoji-learning-v1';

const LEARNING_VERSION = 1 as const;
const MAX_QUERY_LENGTH = 80;
const MAX_QUERY_COUNT = 128;
const MAX_CHOICES_PER_QUERY = 16;
const MAX_CHOICE_COUNT = 1_000_000;
const MAX_EMOJI_ID_LENGTH = 160;

export interface EmojiLearningChoice {
  emojiId: string;
  count: number;
}

export interface EmojiQueryLearning {
  query: string;
  choices: EmojiLearningChoice[];
}

export interface EmojiLearningState {
  version: typeof LEARNING_VERSION;
  queries: EmojiQueryLearning[];
}

export function emptyEmojiLearning(): EmojiLearningState {
  return { version: LEARNING_VERSION, queries: [] };
}

export function loadEmojiLearning(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): EmojiLearningState {
  try {
    return deserializeEmojiLearning(storage.getItem(EMOJI_LEARNING_STORAGE_KEY));
  } catch {
    return emptyEmojiLearning();
  }
}

export function saveEmojiLearning(
  state: EmojiLearningState,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
  try {
    storage.setItem(EMOJI_LEARNING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Search and selection remain available when durable browser storage is unavailable.
  }
}

export function deserializeEmojiLearning(serialized: string | null): EmojiLearningState {
  if (!serialized) return emptyEmojiLearning();

  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!isRecord(parsed) || parsed.version !== LEARNING_VERSION || !Array.isArray(parsed.queries))
      return emptyEmojiLearning();

    const queries: EmojiQueryLearning[] = [];
    const seenQueries = new Set<string>();
    for (const candidate of parsed.queries) {
      if (!isRecord(candidate) || typeof candidate.query !== 'string') continue;
      const query = boundedQuery(candidate.query);
      if (!query || seenQueries.has(query) || !Array.isArray(candidate.choices)) continue;

      const choices: EmojiLearningChoice[] = [];
      const seenEmojiIDs = new Set<string>();
      for (const choice of candidate.choices) {
        if (!isRecord(choice) || typeof choice.emojiId !== 'string') continue;
        const emojiId = boundedEmojiID(choice.emojiId);
        const count = validCount(choice.count);
        if (!emojiId || count === undefined || seenEmojiIDs.has(emojiId)) continue;
        seenEmojiIDs.add(emojiId);
        choices.push({ emojiId, count });
        if (choices.length === MAX_CHOICES_PER_QUERY) break;
      }

      if (!choices.length) continue;
      seenQueries.add(query);
      queries.push({ query, choices });
      if (queries.length === MAX_QUERY_COUNT) break;
    }
    return { version: LEARNING_VERSION, queries };
  } catch {
    return emptyEmojiLearning();
  }
}

export function recordEmojiChoice(
  state: EmojiLearningState,
  rawQuery: string,
  rawEmojiID: string,
): EmojiLearningState {
  const query = boundedQuery(rawQuery);
  const emojiId = boundedEmojiID(rawEmojiID);
  if (!query || !emojiId) return state;

  const currentQuery = state.queries.find((candidate) => candidate.query === query);
  const currentChoice = currentQuery?.choices.find((choice) => choice.emojiId === emojiId);
  const count = Math.min(MAX_CHOICE_COUNT, (currentChoice?.count ?? 0) + 1);
  const choices = [
    { emojiId, count },
    ...(currentQuery?.choices.filter((choice) => choice.emojiId !== emojiId) ?? []),
  ].slice(0, MAX_CHOICES_PER_QUERY);
  const queries = [
    { query, choices },
    ...state.queries.filter((candidate) => candidate.query !== query),
  ].slice(0, MAX_QUERY_COUNT);

  return { version: LEARNING_VERSION, queries };
}

/** Removes one emoji's learned score for one normalized search phrase. */
export function resetEmojiChoice(
  state: EmojiLearningState,
  rawQuery: string,
  rawEmojiID: string,
): EmojiLearningState {
  const query = boundedQuery(rawQuery);
  const emojiId = boundedEmojiID(rawEmojiID);
  if (!query || !emojiId) return state;

  const current = state.queries.find((candidate) => candidate.query === query);
  if (!current?.choices.some((choice) => choice.emojiId === emojiId)) return state;

  const choices = current.choices.filter((choice) => choice.emojiId !== emojiId);
  const queries = choices.length
    ? state.queries.map((candidate) => (candidate.query === query ? { query, choices } : candidate))
    : state.queries.filter((candidate) => candidate.query !== query);
  return { version: LEARNING_VERSION, queries };
}

export function learnedEmojiCounts(state: EmojiLearningState, rawQuery: string): ReadonlyMap<string, number> {
  const query = boundedQuery(rawQuery);
  if (!query) return new Map();
  const choices = state.queries.find((candidate) => candidate.query === query)?.choices ?? [];
  return new Map(choices.map((choice) => [choice.emojiId, choice.count]));
}

function boundedQuery(value: string): string {
  return Array.from(normalizeEmojiQuery(value)).slice(0, MAX_QUERY_LENGTH).join('');
}

function boundedEmojiID(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || Array.from(trimmed).length > MAX_EMOJI_ID_LENGTH) return '';
  return trimmed;
}

function validCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const count = Math.floor(value);
  return count > 0 ? Math.min(MAX_CHOICE_COUNT, count) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
