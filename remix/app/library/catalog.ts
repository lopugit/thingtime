import { PACKAGE_EXAMPLES } from './packages';
import { MORE_PACKAGE_EXAMPLES } from './morePackages';
import { VISUAL_EXAMPLES } from './visualPackages';
import { API_EXAMPLES } from './apis';
import { MAP_SDK_EXAMPLES } from './mapSdks';
import { PLATFORM_API_EXAMPLES } from './platformApis';
export { type LibraryExample } from './types';
// Explicit examples and documented operation families; no colour/layout permutations inflate the count.
export const LIBRARY_EXAMPLES = [...MAP_SDK_EXAMPLES, ...PLATFORM_API_EXAMPLES, ...VISUAL_EXAMPLES, ...API_EXAMPLES, ...PACKAGE_EXAMPLES, ...MORE_PACKAGE_EXAMPLES];
const byId = new Map(LIBRARY_EXAMPLES.map((example) => [example.id, example]));
export const getLibraryExample = (id: string) => byId.get(id);
export const LIBRARY_CATEGORIES = [...new Set(LIBRARY_EXAMPLES.map((example) => example.category))].sort();
