export type ThingAclPage = { ok: true; entries: string[]; nextCursor: string | null; revision: string | null };
type PageReader = (args: { id: string; cursor?: string }, options?: { signal?: AbortSignal }) => Promise<ThingAclPage | { ok: false; error: string }>;

/** Load an owner's editable ACL only when its audience editor is opened.
 * Every page must describe one generation; a changed ACL is retried by the
 * caller as a fresh operation, never merged into a truncated replacement. */
export async function readCompleteThingAcl(read: PageReader, id: string, options?: { signal?: AbortSignal }) {
  const entries = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let revision: string | null | undefined;
  do {
    options?.signal?.throwIfAborted();
    const page = await read({ id, ...(cursor ? { cursor } : {}) }, options);
    options?.signal?.throwIfAborted();
    if (page.ok === false) throw new Error(page.error);
    if (revision !== undefined && revision !== page.revision) throw new Error('Thing access changed while loading. Retry the audience editor.');
    revision = page.revision;
    for (const entry of page.entries) entries.add(entry);
    if (page.nextCursor && cursors.has(page.nextCursor)) throw new Error('Thing access pagination did not advance. Retry the audience editor.');
    if (page.nextCursor) cursors.add(page.nextCursor);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { entries: [...entries], revision: revision ?? null };
}
