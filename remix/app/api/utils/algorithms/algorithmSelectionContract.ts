import { copyBoundedJson } from '../../../utils/boundedJson';
export type AlgorithmSelection = { algorithmId: string | null; version: string };
export type AlgorithmSelectionWrite = { algorithmId: string | null; expectedVersion: string; writeId: string };
export type AlgorithmSelectionAcknowledgment = AlgorithmSelectionWrite & { result: AlgorithmSelection };
const validId = (value: unknown) => value === null || (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value));
const validVersion = (value: unknown): value is string => typeof value === 'string' && /^algorithm-selection-v1:[a-f0-9]{64}$/.test(value);
const fail = (): never => {
	throw new Error('Invalid active algorithm synchronization.');
};
export function parseAlgorithmSelection(value: unknown): AlgorithmSelection {
	const row = copyBoundedJson(value, { maxBytes: 4096, maxDepth: 3, maxNodes: 20 });
	if (
		!row ||
		typeof row !== 'object' ||
		Array.isArray(row) ||
		Object.keys(row).length !== 2 ||
		!validId(row.algorithmId) ||
		!validVersion(row.version)
	)
		return fail();
	return { algorithmId: row.algorithmId as string | null, version: row.version };
}
export function parseAlgorithmSelectionWrite(value: unknown): AlgorithmSelectionWrite {
	const row = copyBoundedJson(value, { maxBytes: 4096, maxDepth: 3, maxNodes: 20 });
	if (
		!row ||
		typeof row !== 'object' ||
		Array.isArray(row) ||
		Object.keys(row).length !== 3 ||
		!validId(row.algorithmId) ||
		!validVersion(row.expectedVersion) ||
		typeof row.writeId !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(row.writeId)
	)
		return fail();
	return { algorithmId: row.algorithmId as string | null, expectedVersion: row.expectedVersion, writeId: row.writeId };
}
export function parseAlgorithmSelectionAcknowledgment(value: unknown): AlgorithmSelectionAcknowledgment {
	const row = copyBoundedJson(value, { maxBytes: 8192, maxDepth: 4, maxNodes: 40 });
	if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 4) return fail();
	const { result, ...command } = row;
	const write = parseAlgorithmSelectionWrite(command),
		selection = parseAlgorithmSelection(result);
	if (selection.algorithmId !== write.algorithmId) return fail();
	return { ...write, result: selection };
}
