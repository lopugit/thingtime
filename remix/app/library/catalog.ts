import type { LibraryExample } from './types';
export { type LibraryExample } from './types';
// Infrastructure ships first. Curated examples are registered in a subsequent release.
export const LIBRARY_EXAMPLES: LibraryExample[] = [];
const byId = new Map(LIBRARY_EXAMPLES.map((example) => [example.id, example]));
export const getLibraryExample = (id: string) => byId.get(id);
export const LIBRARY_CATEGORIES = [...new Set(LIBRARY_EXAMPLES.map((example) => example.category))].sort();
