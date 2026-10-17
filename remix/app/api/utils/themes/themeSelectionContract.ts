import { copyBoundedJson } from '../../../utils/boundedJson';
export type ThemeSelection = { themeId: string | null; version: string };
export type ThemeSelectionWrite = { themeId: string | null; expectedVersion: string; writeId: string };
export type ThemeSelectionAcknowledgment = ThemeSelectionWrite & { result: ThemeSelection };
const validId = (value: unknown) => value === null || (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value));
const validVersion = (value: unknown): value is string => typeof value === 'string' && /^theme-selection-v1:[a-f0-9]{64}$/.test(value);
const fail = (): never => {
	throw new Error('Invalid active theme synchronization.');
};
export function parseThemeSelection(value: unknown): ThemeSelection {
	const row = copyBoundedJson(value, { maxBytes: 4096, maxDepth: 3, maxNodes: 20 });
	if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 2 || !validId(row.themeId) || !validVersion(row.version))
		return fail();
	return { themeId: row.themeId as string | null, version: row.version };
}
export function parseThemeSelectionWrite(value: unknown): ThemeSelectionWrite {
	const row = copyBoundedJson(value, { maxBytes: 4096, maxDepth: 3, maxNodes: 20 });
	if (
		!row ||
		typeof row !== 'object' ||
		Array.isArray(row) ||
		Object.keys(row).length !== 3 ||
		!validId(row.themeId) ||
		!validVersion(row.expectedVersion) ||
		typeof row.writeId !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(row.writeId)
	)
		return fail();
	return { themeId: row.themeId as string | null, expectedVersion: row.expectedVersion, writeId: row.writeId };
}
export function parseThemeSelectionAcknowledgment(value: unknown): ThemeSelectionAcknowledgment {
	const row = copyBoundedJson(value, { maxBytes: 8192, maxDepth: 4, maxNodes: 40 });
	if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 4) return fail();
	const { result, ...command } = row;
	const write = parseThemeSelectionWrite(command),
		selection = parseThemeSelection(result);
	if (selection.themeId !== write.themeId) return fail();
	return { ...write, result: selection };
}
