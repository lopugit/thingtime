import { copyBoundedJson } from '../utils/boundedJson.ts';
import { algorithmTransferContent } from '../utils/thingTransfer/algorithm.ts';
import type { AlgorithmTransferContent } from '../api/utils/algorithms/algorithmTransferCore.ts';
import type { TimelineSnapshot } from './contract.ts';
import { TIMELINE_EVENT_MAX_BYTES } from './contract.ts';

export const ALGORITHM_CONTENT_ADAPTER = 'algorithm-content';
export type AlgorithmContentValue = {
	crystal: AlgorithmTransferContent & { description: string };
	folderId: string | null;
};
const budget = { maxBytes: TIMELINE_EVENT_MAX_BYTES, maxDepth: 12, maxNodes: 100_000, sortKeys: true };
const invalid = (): never => { throw new Error('Invalid algorithm content history'); };

/** Saved profile data only. Training observations, account authority, sharing,
 * lineage and active selection never enter a restorable algorithm snapshot. */
export function algorithmContentSnapshot(input: unknown): TimelineSnapshot {
	const row = input as any;
	if (!row || !row.crystal || (row.folderId !== null && (typeof row.folderId !== 'string' || row.folderId.length > 200))) invalid();
	const description = row.crystal.description ?? '';
	if (typeof description !== 'string' || description.length > 300) invalid();
	const crystal = { ...algorithmTransferContent(row.crystal), description };
	return { adapter: ALGORITHM_CONTENT_ADAPTER, version: 1,
		value: copyBoundedJson({ crystal, folderId: row.folderId }, budget, 'Algorithm history') };
}

export function algorithmContentValue(snapshot: TimelineSnapshot): AlgorithmContentValue {
	if (snapshot.adapter !== ALGORITHM_CONTENT_ADAPTER || snapshot.version !== 1) invalid();
	const value = copyBoundedJson(snapshot.value, budget, 'Algorithm history');
	if (JSON.stringify(algorithmContentSnapshot(value).value) !== JSON.stringify(value)) invalid();
	return value as AlgorithmContentValue;
}
