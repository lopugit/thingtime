export const THING_STORAGE_FRAGMENT = '#thing-storage';

/** Storage always opens the exact Thing permalink, including its archive view
 * when required. Carry only the access or database context supplied by the caller. */
export function thingStorageHref(id: string, options: {
  archive?: boolean;
  dataPlane?: string | null;
  key?: string;
  fromThings?: boolean;
} = {}): string {
  const query = new URLSearchParams();
  if (options.archive) query.set('archive', 'true');
  if (options.dataPlane) query.set('dataPlane', options.dataPlane);
  if (options.key) query.set('key', options.key);
  if (options.fromThings) query.set('from', 'things');
  return `/thing/${encodeURIComponent(id)}${query.size ? `?${query}` : ''}${THING_STORAGE_FRAGMENT}`;
}
