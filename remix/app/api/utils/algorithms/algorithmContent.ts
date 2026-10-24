import type { EngagementEvent } from '../things/feedRanking';

export const MAX_SAVED_ALGORITHMS = 50;
export const normalizeAlgorithmName = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 60) : '';
export const sanitizeAlgorithmEmoji = (value: unknown): string => {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return trimmed && [...trimmed].length <= 3 ? trimmed : '🧠';
};
export const sanitizeAlgorithmEvents = (value: unknown): EngagementEvent[] => !Array.isArray(value) ? [] : value.filter(
	(entry): entry is EngagementEvent => !!entry && typeof entry === 'object' && typeof entry.thingId === 'string' && typeof entry.signal === 'string'
).slice(0, 100);
