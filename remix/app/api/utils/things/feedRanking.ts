// Pure, deterministic feed-algorithm maths: engagement events train interest
// weights, and weights + recency score posts. No I/O here — this module is the
// single ranking code path shared by the feed query, the track endpoint, and
// seeding (FUNDAMENTALS §2: test == live).

export type AlgorithmWeights = {
  types: Record<string, number>;
  tags: Record<string, number>;
  authors: Record<string, number>;
};

export type EngagementSignal = 'view' | 'dwell' | 'expand' | 'react' | 'comment' | 'share';

export type EngagementEvent = {
  thingId: string;
  signal: EngagementSignal;
  dwellMs?: number;
};

// A post reduced to the features the algorithm learns from / scores against.
export type PostFeatures = {
  type: string;
  tags: string[];
  ownerId: string;
  createdAt: Date;
};

export const emptyWeights = (): AlgorithmWeights => ({ types: {}, tags: {}, authors: {} });

const WEIGHT_CLAMP = 50;
// Every applied batch decays all existing weights slightly, so an algorithm
// drifts toward what its owner engages with *lately* — deterministically.
const BATCH_DECAY = 0.995;
const MAX_DWELL_SIGNAL = 3;

export const SIGNAL_WEIGHTS: Record<EngagementSignal, number> = {
  view: 0.5,
  dwell: 0, // computed from dwellMs
  expand: 1.5,
  react: 2,
  comment: 3,
  share: 4
};

export const signalStrength = (event: EngagementEvent): number => {
  if (event.signal === 'dwell') {
    const dwellMs = Math.max(0, Number(event.dwellMs) || 0);
    return Math.min(dwellMs / 4000, MAX_DWELL_SIGNAL);
  }
  return SIGNAL_WEIGHTS[event.signal] ?? 0;
};

const clampWeight = (value: number) => Math.max(-WEIGHT_CLAMP, Math.min(WEIGHT_CLAMP, value));

const bump = (bucket: Record<string, number>, key: string, delta: number) => {
  if (!key || !delta) return;
  bucket[key] = clampWeight((bucket[key] || 0) + delta);
};

const decayBucket = (bucket: Record<string, number>) => {
  Object.keys(bucket).forEach((key) => {
    const decayed = bucket[key] * BATCH_DECAY;
    // drop negligible entries so weight maps don't grow without bound
    if (Math.abs(decayed) < 0.01) {
      delete bucket[key];
    } else {
      bucket[key] = decayed;
    }
  });
};

// Apply a batch of engagement events to a weights object (mutates a copy).
// Events whose thingId isn't in `featuresByThingId` are ignored.
export const applyEventsToWeights = (
  weights: AlgorithmWeights,
  events: EngagementEvent[],
  featuresByThingId: Map<string, PostFeatures>
): { weights: AlgorithmWeights; applied: number } => {
  const next: AlgorithmWeights = {
    types: { ...weights.types },
    tags: { ...weights.tags },
    authors: { ...weights.authors }
  };

  let applied = 0;
  events.forEach((event) => {
    const features = featuresByThingId.get((event as any)?.thingId);
    if (!features) return;
    const strength = signalStrength(event);
    if (strength <= 0) return;

    bump(next.types, features.type, strength);
    features.tags.forEach((tag) => bump(next.tags, tag, strength));
    bump(next.authors, features.ownerId, strength);
    applied += 1;
  });

  if (applied > 0) {
    decayBucket(next.types);
    decayBucket(next.tags);
    decayBucket(next.authors);
  }

  return { weights: next, applied };
};

// Interest a set of weights expresses in one post's features.
export const interestScore = (weights: AlgorithmWeights, features: PostFeatures): number => {
  const typeScore = weights.types[features.type] || 0;
  const tagScores = features.tags.map((tag) => weights.tags[tag] || 0);
  const tagScore = tagScores.length ? tagScores.reduce((a, b) => a + b, 0) / tagScores.length : 0;
  const authorScore = weights.authors[features.ownerId] || 0;
  return typeScore + tagScore + authorScore;
};

// Ranked-feed score: interest lifts a post, age dilutes it. Deterministic for
// a fixed `now` — callers pass one timestamp per request so a page is stable.
export const scorePost = (weights: AlgorithmWeights, features: PostFeatures, now: Date): number => {
  const ageHours = Math.max(0, (now.getTime() - features.createdAt.getTime()) / 3_600_000);
  const interest = Math.max(0, interestScore(weights, features));
  return (1 + interest) / (1 + ageHours / 24);
};

// The strongest interests across all buckets — surfaced in the UI so an
// algorithm is inspectable rather than a black box.
export const topInterests = (
  weights: AlgorithmWeights,
  limit = 8
): Array<{ kind: 'type' | 'tag' | 'author'; key: string; weight: number }> => {
  const entries: Array<{ kind: 'type' | 'tag' | 'author'; key: string; weight: number }> = [];
  Object.entries(weights.types).forEach(([key, weight]) => entries.push({ kind: 'type', key, weight }));
  Object.entries(weights.tags).forEach(([key, weight]) => entries.push({ kind: 'tag', key, weight }));
  Object.entries(weights.authors).forEach(([key, weight]) => entries.push({ kind: 'author', key, weight }));
  return entries
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((entry) => ({ ...entry, weight: Math.round(entry.weight * 100) / 100 }));
};
