import type { AlgorithmWeights } from '../things/feedRanking';

export type AlgorithmTransferContent = {
  name: string;
  emoji: string;
  weights: AlgorithmWeights;
  eventCount: number;
  lastTrainedAt: string | null;
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** A portable interest profile is bounded data, never training events to run.
 * Reject instead of truncating, so a successful import preserves every weight. */
export const parseAlgorithmTransfer = (value: unknown): AlgorithmTransferContent => {
  if (!record(value) || Object.keys(value).some(key => !['name', 'emoji', 'weights', 'eventCount', 'lastTrainedAt'].includes(key))) {
    throw new Error('An algorithm transfer contains only name, emoji, weights and training statistics');
  }
  const { name, emoji, weights, eventCount, lastTrainedAt } = value;
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 60 ||
    typeof emoji !== 'string' || !emoji.trim() || emoji !== emoji.trim() || [...emoji].length > 3) {
    throw new Error('Invalid algorithm name or emoji');
  }
  if (!Number.isSafeInteger(eventCount) || (eventCount as number) < 0 ||
    (lastTrainedAt !== null && (typeof lastTrainedAt !== 'string' || !Number.isFinite(Date.parse(lastTrainedAt)) || new Date(lastTrainedAt).toISOString() !== lastTrainedAt))) {
    throw new Error('Invalid algorithm training statistics');
  }
  if (!record(weights) || Object.keys(weights).length !== 3) throw new Error('Invalid algorithm weights');
  const result: AlgorithmWeights = { types: {}, tags: {}, authors: {} };
  for (const bucket of ['types', 'tags', 'authors'] as const) {
    const values = weights[bucket];
    if (!record(values) || Object.keys(values).length > 10_000) throw new Error('An algorithm weight bucket may contain at most 10000 entries');
    for (const [key, weight] of Object.entries(values)) {
      if (!key || key.length > 512 || ['__proto__', 'prototype', 'constructor'].includes(key) || [...key].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
        typeof weight !== 'number' || !Number.isFinite(weight) || Math.abs(weight) > 50) {
        throw new Error('Invalid algorithm weight');
      }
      result[bucket][key] = weight;
    }
  }
  return { name, emoji, weights: result, eventCount: eventCount as number, lastTrainedAt: lastTrainedAt as string | null };
};
