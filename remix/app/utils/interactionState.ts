import { sanitizeReactionToken, MAX_REACTION_KEYS_PER_POST, MAX_REACTIONS_PER_USER_PER_POST } from './reactionTokens';

export type InteractionState = {
	id: string;
	revision: string | null;
	saved: boolean;
	savedAt?: string | null;
	reactionCounts?: Record<string, number>;
	reactions: string[];
};
export type InteractionWrite = { id: string; expectedRevision: string | null; kind: 'save' | 'reaction'; active: boolean; emoji?: string };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 200;
const revision = (value: unknown): value is string | null => value === null || (typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value));
export function interactionWrite(value: unknown): InteractionWrite {
	if (
		!record(value) ||
		Object.keys(value).some((key) => !['id', 'expectedRevision', 'kind', 'active', 'emoji'].includes(key)) ||
		!id(value.id) ||
		!revision(value.expectedRevision) ||
		(value.kind !== 'save' && value.kind !== 'reaction') ||
		typeof value.active !== 'boolean'
	)
		throw new Error('Invalid conditional interaction command.');
	const emoji = value.kind === 'reaction' ? sanitizeReactionToken(value.emoji) : null;
	if (value.kind === 'reaction' ? !emoji : value.emoji !== undefined) throw new Error('Invalid interaction token.');
	return {
		id: value.id,
		expectedRevision: value.expectedRevision,
		kind: value.kind as InteractionWrite['kind'],
		active: value.active,
		...(emoji ? { emoji } : {})
	};
}
export function interactionState(value: unknown): InteractionState {
	if (
		!record(value) ||
		!id(value.id) ||
		!revision(value.revision) ||
		typeof value.saved !== 'boolean' ||
		!Array.isArray(value.reactions) ||
		value.reactions.length > MAX_REACTIONS_PER_USER_PER_POST ||
		value.reactions.some((x) => !sanitizeReactionToken(x) || sanitizeReactionToken(x) !== x) ||
		new Set(value.reactions).size !== value.reactions.length
	)
		throw new Error('Invalid account interaction state.');
	if (
		value.reactionCounts !== undefined &&
		(!record(value.reactionCounts) ||
			Object.keys(value.reactionCounts).length > MAX_REACTION_KEYS_PER_POST ||
			Object.entries(value.reactionCounts).some(
				([token, count]) => sanitizeReactionToken(token) !== token || !Number.isSafeInteger(count) || Number(count) < 0
			))
	)
		throw new Error('Invalid reaction counts.');
	if (value.savedAt !== undefined && value.savedAt !== null && (typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))))
		throw new Error('Invalid bookmark timestamp.');
	return {
		id: value.id,
		revision: value.revision,
		saved: value.saved,
		...(value.reactionCounts ? { reactionCounts: { ...(value.reactionCounts as Record<string, number>) } } : {}),
		...(value.savedAt !== undefined ? { savedAt: value.savedAt as string | null } : {}),
		reactions: [...value.reactions].sort() as string[]
	};
}
export const interactionMatches = (state: InteractionState, write: InteractionWrite) =>
	write.kind === 'save' ? state.saved === write.active : state.reactions.includes(write.emoji!) === write.active;
