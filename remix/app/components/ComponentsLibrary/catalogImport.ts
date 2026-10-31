import { COMPONENT_KEY_PATTERN, MAX_COMPONENT_KEY_CHARS, validateThingtimeCrystal } from '../../schemas/registry';

export const MAX_CATALOG_FILE_BYTES = 32 * 1024 * 1024;
const MAX_BATCH_BYTES = 1_500_000;
export type CatalogDefinition = Record<string, unknown> & { slug: string };
export type CatalogImport = { definitions: CatalogDefinition[]; batches: string[]; libraries: string[] };
export type CatalogProgress = { processed: number; created: number; refreshed: number; unchanged: number; skipped: number };
export const emptyCatalogProgress = (): CatalogProgress => ({ processed: 0, created: 0, refreshed: 0, unchanged: 0, skipped: 0 });

export function parseCatalogImport(text: string): CatalogImport {
  const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
  if (bytes(text) > MAX_CATALOG_FILE_BYTES) throw new Error('Choose a catalog smaller than 32 MiB.');
  const parsed = JSON.parse(text);
  const definitions = Array.isArray(parsed) ? parsed : parsed?.components;
  if (!Array.isArray(definitions) || !definitions.length || definitions.length > 5000) {
    throw new Error('The catalog must contain between 1 and 5,000 component definitions.');
  }
  const slugs = new Set<string>();
  const libraries = new Set<string>();
  const batches: string[] = [];
  let batch: string[] = [];
  let batchBytes = 17; // {"components":[]}, including a spare separator byte.
  for (const [index, def] of definitions.entries()) {
    const slug = typeof def?.slug === 'string' ? def.slug.trim() : '';
    if (!slug || slug !== def.slug || slug.length > MAX_COMPONENT_KEY_CHARS || !COMPONENT_KEY_PATTERN.test(slug)) {
      throw new Error(`Component ${index + 1} has an invalid slug.`);
    }
    if (slugs.has(slug)) throw new Error(`Duplicate component: ${slug}.`);
    slugs.add(slug);
    const validated = validateThingtimeCrystal(['component'], {
      name: def.name, description: def.description, library: def.library, category: def.category,
      componentKey: slug, familyKey: def.familyKey, version: def.version ?? 1,
      args: def.args, render: def.render, previewBg: def.previewBg
    });
    if (validated.ok === false) throw new Error(`${slug}: ${validated.error}`);
    if (typeof def.library === 'string') libraries.add(def.library);
    const encoded = JSON.stringify(def);
    const size = bytes(encoded) + 1;
    if (size + 17 > MAX_BATCH_BYTES) throw new Error(`${slug} is too large to import.`);
    if (batch.length === 100 || batchBytes + size > MAX_BATCH_BYTES) {
      batches.push(`{"components":[${batch.join(',')}]}`);
      batch = [];
      batchBytes = 17;
    }
    batch.push(encoded);
    batchBytes += size;
  }
  if (batch.length) batches.push(`{"components":[${batch.join(',')}]}`);
  return { definitions, batches, libraries: [...libraries].sort() };
}

export function addCatalogProgress(previous: CatalogProgress, response: unknown, expected: number): CatalogProgress {
  const result = response as Record<string, unknown> | null;
  if (result?.ok !== true || result.received !== expected ||
    !['created', 'refreshed', 'unchanged', 'skipped'].every(key => Number.isSafeInteger(result[key]) && Number(result[key]) >= 0) ||
    Number(result.created) + Number(result.refreshed) + Number(result.unchanged) + Number(result.skipped) !== expected) {
    throw new Error('The server returned an incomplete import result. Re-importing the catalog safely checks existing entries.');
  }
  return {
    processed: previous.processed + expected,
    created: previous.created + Number(result.created), refreshed: previous.refreshed + Number(result.refreshed),
    unchanged: previous.unchanged + Number(result.unchanged), skipped: previous.skipped + Number(result.skipped)
  };
}

export async function publishCatalogImport(catalog: CatalogImport, options: {
  signal: AbortSignal;
  send: (body: string, signal: AbortSignal) => Promise<unknown>;
  pause: (signal: AbortSignal) => Promise<void>;
  onProgress: (progress: CatalogProgress) => void;
}): Promise<CatalogProgress> {
  let progress = emptyCatalogProgress();
  for (const [index, batch] of catalog.batches.entries()) {
    options.signal.throwIfAborted();
    if (index) await options.pause(options.signal);
    options.signal.throwIfAborted();
    const result = await options.send(batch, options.signal);
    options.signal.throwIfAborted();
    progress = addCatalogProgress(progress, result, JSON.parse(batch).components.length);
    options.onProgress(progress);
    if (progress.skipped) throw new Error('Some components were skipped. Import stopped; published batches remain saved. Check the definitions and retry.');
  }
  return progress;
}
