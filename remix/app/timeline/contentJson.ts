import { copyBoundedJson, type JsonValue } from '../utils/boundedJson.ts';
import { MAX_STORABLE_NESTING } from '../schemas/storableLimits.ts';

export const TIMELINE_CONTENT_MAX_DEPTH = MAX_STORABLE_NESTING + 1;

/** Inert materialized content is distinct from an event/control envelope.
 * A restorable value wraps crystal at depth1; primitive children may sit one
 * level below the canonical container guard. Callers declare extra transport
 * wrappers rather than imposing a lower depth or total-node content ceiling.
 * Composite views may carry several independently storable snapshots. */
export function copyTimelineContent(value: unknown, label: string, wrapperDepth = 0, maxBytes = Infinity): JsonValue {
 return copyBoundedJson(value, { maxBytes, maxDepth: TIMELINE_CONTENT_MAX_DEPTH + wrapperDepth, maxNodes: Infinity, sortKeys: true }, label);
}
