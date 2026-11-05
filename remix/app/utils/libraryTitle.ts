/** Display metadata only; protected content retains its dedicated writer. */
export const normalizeLibraryTitle = (value: unknown): string | null =>
	typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 120 ? value.trim() : null;
export const validOptionalLibraryTitle = (value: unknown): value is string | null =>
	value === null || (typeof value === 'string' && value.length <= 120);
