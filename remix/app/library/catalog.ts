import { PACKAGE_EXAMPLES } from './packages';
import { MORE_PACKAGE_EXAMPLES } from './morePackages';
import { VISUAL_EXAMPLES } from './visualPackages';
import { API_EXAMPLES } from './apis';
export { type LibraryExample } from './types';
// Explicit examples and documented operation families; no colour/layout permutations inflate the count.
export const LIBRARY_EXAMPLES = [...VISUAL_EXAMPLES, ...API_EXAMPLES, ...PACKAGE_EXAMPLES, ...MORE_PACKAGE_EXAMPLES];
const byId = new Map(LIBRARY_EXAMPLES.map((example) => [example.id, example]));
export const getLibraryExample = (id: string) => byId.get(id);
export const LIBRARY_CATEGORIES = [...new Set(LIBRARY_EXAMPLES.map((example) => example.category))].sort();
