export type SeamlessMode = 'edit' | 'view' | 'layout' | 'builder' | 'container';
export const isSeamlessMode = (value: unknown): value is SeamlessMode =>
	value === 'edit' || value === 'view' || value === 'layout' || value === 'builder' || value === 'container';

// Never guess between two template arguments with the same displayed value.
export const matchingTextArg = (specs: Array<{ name: string; type?: string }>, values: Record<string, unknown>, text: string): string | null => {
	const matches = specs.filter((spec) => (!spec.type || spec.type === 'string' || spec.type === 'text') && String(values[spec.name] ?? '') === text);
	return matches.length === 1 ? matches[0].name : null;
};

export const usesPageRuntime = (mode: unknown): boolean => mode !== 'builder' && mode !== 'container';
