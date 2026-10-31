import { parseCloudInventoryNode, parseCloudInventoryRoot, type CloudInventoryNode, type CloudInventoryRoot } from './cloudInventory';

export const CLOUD_INVENTORY_PAGES_REQUIREMENTS = { 'api.files': '1.5.0' } as const;
export const CLOUD_INVENTORY_PAGE_ENTRIES = 128;
// Canonical cloud nodes and their sync stamps share a 1 MiB journal page.
export const CLOUD_INVENTORY_PAGE_BYTES = 384 * 1024;
export const CLOUD_INVENTORY_TIMEOUT_MS = 240_000;
export type CloudInventoryPage = CloudInventoryRoot & {
	version: 1;
	generation: string;
	ordinal: number;
	nodes: CloudInventoryNode[];
	totalEntries?: number;
};

/** Per-page framing. The journal additionally checks cross-page path/ID
 * uniqueness, physical ancestry and the exact terminal count before sealing. */
export function parseCloudInventoryPage(value: unknown, rootId: string): CloudInventoryPage {
	const page = value as CloudInventoryPage;
	if (!page || page.version !== 1 || page.rootId !== rootId ||
		typeof page.generation !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(page.generation) ||
		!Number.isSafeInteger(page.ordinal) || page.ordinal < 0 || !Array.isArray(page.nodes) || page.nodes.length > CLOUD_INVENTORY_PAGE_ENTRIES ||
		(page.totalEntries !== undefined && (!Number.isSafeInteger(page.totalEntries) || page.totalEntries < 0)) ||
		(!page.nodes.length && page.totalEntries === undefined)) throw Error('Cloud inventory page is incomplete or invalid.');
	const result: CloudInventoryPage = { ...parseCloudInventoryRoot(page), version: 1, generation: page.generation,
		ordinal: page.ordinal, nodes: page.nodes.map(parseCloudInventoryNode),
		...(page.totalEntries === undefined ? {} : { totalEntries: page.totalEntries }) };
	if (new TextEncoder().encode(JSON.stringify(result)).length > CLOUD_INVENTORY_PAGE_BYTES)
		throw Error('Cloud inventory page exceeds its byte bound.');
	return result;
}
