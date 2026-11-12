/** Authored layouts choose a name, never an executable renderer or a source.
 * Only own entries explicitly installed by the host can provide content. */
export function contentSlot<T>(slots: Record<string, T> | undefined, key: unknown): T | undefined {
  return typeof key === 'string' && /^[a-z][a-z0-9-]*$/.test(key) && slots && Object.prototype.hasOwnProperty.call(slots, key)
    ? slots[key] : undefined;
}
