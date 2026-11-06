// Shared canonical authored-media scanner. These are attachment-content URLs,
// never filename or prose identity guesses. The binder applies its own budget.
const CONTENT_URL_PATTERN = /\/api\/v1\/attachments\/content\?id=([A-Za-z0-9_-]{8,128})/g;
export function collectWebpageAttachmentIds(crystal: unknown): string[] {
  const ids = new Set<string>(), seen = new Set<object>();
  const blocks = (crystal as Record<string, unknown> | null)?.blocks;
  const pending: unknown[] = Array.isArray(blocks) ? [...blocks].reverse() : [];
  const collect = (value: unknown) => { if (typeof value === 'string') for (const match of value.matchAll(CONTENT_URL_PATTERN)) ids.add(match[1]); };
  while (pending.length) {
    const block = pending.pop();
    if (!block || typeof block !== 'object' || seen.has(block)) continue;
    seen.add(block);
    const row = block as Record<string, unknown>;
    collect(row.src); collect(row.html);
    for (const bag of [row.args, row.css]) if (bag && typeof bag === 'object' && !Array.isArray(bag)) for (const value of Object.values(bag)) collect(value);
    if (Array.isArray(row.children)) pending.push(...[...row.children].reverse());
  }
  return [...ids];
}
