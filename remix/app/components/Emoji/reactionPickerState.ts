import { sanitizeReactionToken } from '../../utils/reactionTokens';

// Origin + database + actor scope the optimistic list and the retained input.
// JSON tuples cannot collide when an identifier itself contains a separator.
export const reactionPickerScope = (origin: string, dataPlane: string | null, userId: string | null) =>
  JSON.stringify([origin, dataPlane, userId]);

export const cleanRecentReactions = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(sanitizeReactionToken).filter((token): token is string => token !== null))];
};

// Nine is the requested shortcut count; the full picker retains the whole list.
export const quickRecentReactions = (recent: readonly string[], defaults: readonly string[] = []) =>
  cleanRecentReactions(recent).filter((token) => !defaults.includes(token)).slice(0, 9);

export type RecentReactionState = {
  list: string[];
  sequence: number;
  latestReply: number;
  latestSnapshot: Set<string>;
  confirmed: Map<string, number>;
};

export const createRecentReactionState = (seed: unknown): RecentReactionState => ({
  list: cleanRecentReactions(seed), sequence: 0, latestReply: 0, latestSnapshot: new Set(), confirmed: new Map()
});

// Capture intent before transport, not when a response arrives. Responses and
// the initial GET can arrive in any order; confirmed local additions lead every
// older snapshot while the rest of the server history is still retained.
export const beginRecentReaction = (state: RecentReactionState) => ++state.sequence;

export const receiveRecentReactions = (state: RecentReactionState, serverList: unknown) => {
  const received = cleanRecentReactions(serverList);
  // This is the initial GET. Once an addition has completed it may be an
  // older snapshot, so it can fill history but cannot reorder live selections.
  state.list = state.confirmed.size ? cleanRecentReactions([...state.list, ...received]) : received;
};

export const recordRecentReaction = (state: RecentReactionState, token: string, serverList: unknown, order: number) => {
  if (!sanitizeReactionToken(token)) return;
  const previousOrder = state.confirmed.get(token) ?? 0;
  state.confirmed.set(token, Math.max(order, previousOrder));
  const received = cleanRecentReactions(serverList);
  if (order >= state.latestReply) {
    // A current mutation response includes newer use from other tabs/devices.
    // Do not pin every historical local selection ahead of that server order.
    state.latestReply = order;
    state.latestSnapshot = new Set(received);
    state.list = cleanRecentReactions([token, ...received, ...state.list]);
  } else if (order > previousOrder) {
    if (state.latestSnapshot.has(token)) {
      // The newer snapshot already placed this addition among external use.
      // Its delayed receipt must not move it ahead of those server entries.
      state.list = cleanRecentReactions([...state.list, ...received]);
      return;
    }
    const list = state.list.filter((entry) => entry !== token);
    let insertion = 0;
    list.forEach((entry, index) => {
      if ((state.confirmed.get(entry) ?? 0) > order) insertion = index + 1;
    });
    list.splice(insertion, 0, token);
    state.list = cleanRecentReactions([...list, ...received]);
  }
};
