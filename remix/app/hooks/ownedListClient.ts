/** Drain ordinary owned catalogues without turning a failed tail into success. */
export type OwnedListOptions = {
  signal?: AbortSignal;
  expectedActor?: string;
  expectedDataPlane?: string | null;
  expectedApiOrigin?: string;
};
export type OwnedListScope = {
  actor?: string;
  dataPlane?: string | null;
  generation: number;
  pending: boolean;
};
type Page = Record<string, any> & { ok: true; nextCursor: string | null };

export function createOwnedListClient({ resource, minimumVersion, request, requireCapability, scope, initialScope }: {
  resource: 'themes' | 'algorithms';
  minimumVersion: string;
  request: (url: string, options: OwnedListOptions) => Promise<any>;
  requireCapability: (feature: string, version: string) => Promise<unknown>;
  scope: () => OwnedListScope;
  initialScope?: OwnedListScope;
}) {
  const owner = { ...(initialScope ?? scope()) };
  const begin = (options: OwnedListOptions) => {
    const initial = owner;
    const assertCurrent = () => {
      options.signal?.throwIfAborted();
      const current = scope();
      if (initial.pending || current.pending || current.actor !== initial.actor ||
          current.dataPlane !== initial.dataPlane || current.generation !== initial.generation) {
        throw new Error('The account or database changed while loading your catalogue.');
      }
    };
    const pinned = { ...options,
      expectedActor: options.expectedActor ?? initial.actor,
      expectedDataPlane: options.expectedDataPlane === undefined ? initial.dataPlane : options.expectedDataPlane };
    assertCurrent();
    return { assertCurrent, pinned };
  };
  const read = async (cursor: string | undefined, options: OwnedListOptions, assertCurrent: () => void): Promise<Page> => {
    assertCurrent();
    await requireCapability(`api.${resource}`, minimumVersion);
    assertCurrent();
    const query = new URLSearchParams({ page: '1' });
    if (cursor !== undefined) query.set('cursor', cursor);
    const page = await request(`/api/v1/${resource}?${query}`, options);
    assertCurrent();
    if (!page || page.ok !== true || !Array.isArray(page[resource]) || page[resource].length > 64 ||
        !(page.nextCursor === null || (typeof page.nextCursor === 'string' && page.nextCursor.length > 0)) ||
        page[resource].some((row: any) => !row || typeof row.id !== 'string' || !row.id) ||
        (resource === 'algorithms' && !(page.activeAlgorithmId === null || typeof page.activeAlgorithmId === 'string'))) {
      throw new Error(`Thingtime returned an invalid ${resource} page.`);
    }
    return page;
  };
  return {
    listPage: async (args?: { cursor?: string }, options: OwnedListOptions = {}) => {
      const { assertCurrent, pinned } = begin(options);
      return read(args?.cursor, pinned, assertCurrent);
    },
    list: async (_args?: unknown, options: OwnedListOptions = {}) => {
      const { assertCurrent, pinned } = begin(options);
      const rows = new Map<string, any>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      let first: Page | undefined;
      for (;;) {
        const page = await read(cursor, pinned, assertCurrent);
        if (!first) first = page;
        else if (resource === 'algorithms' && page.activeAlgorithmId !== first.activeAlgorithmId) {
          throw new Error('The active algorithm changed while loading your catalogue. Retry the list.');
        }
        for (const row of page[resource]) {
          if (!rows.has(row.id)) rows.set(row.id, row);
        }
        // A work window may contain only suppressed legacy twins or live
        // observations already seen. Only the opaque cursor establishes progress.
        if (page.nextCursor === null) return { ...first, [resource]: [...rows.values()], nextCursor: null };
        if (cursors.has(page.nextCursor)) throw new Error(`Thingtime returned a non-progressing ${resource} cursor.`);
        cursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }
    }
  };
}

/** Compatibility export for existing profile import consumers. */
export { transferImportMinimumVersion as ownedProfileImportMinimumVersion } from '../utils/thingTransfer/remoteCapabilities';
