export type SeamlessMode = 'edit' | 'view' | 'layout' | 'builder';
export const isSeamlessMode = (value: unknown): value is SeamlessMode =>
	value === 'edit' || value === 'view' || value === 'layout' || value === 'builder';

// Never guess between two template arguments with the same displayed value.
export const matchingTextArg = (specs: Array<{ name: string; type?: string }>, values: Record<string, unknown>, text: string): string | null => {
	const matches = specs.filter((spec) => (!spec.type || spec.type === 'string' || spec.type === 'text') && String(values[spec.name] ?? '') === text);
	return matches.length === 1 ? matches[0].name : null;
};

export const usesPageRuntime = (mode: unknown): boolean => mode !== 'builder';

// Route controls must not become data inputs or refetch otherwise identical pages.
export const pageRuntimeSearch = (pathname: string, search: string): string => {
	const params = new URLSearchParams(search);
	if (pathname === '/builder' || /^\/(p|t)\//.test(pathname)) {
		if (isSeamlessMode(params.get('mode')) || ['run', 'visit', 'container'].includes(params.get('mode') || '')) params.delete('mode');
		if (pathname === '/builder') params.delete('page');
	}
	return params.toString();
};
