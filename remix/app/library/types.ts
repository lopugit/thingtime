export type ExampleKind = 'thing' | 'action' | 'component';
export type LibraryExample = {
	id: string;
	provider: string;
	title: string;
	description: string;
	category: string;
	kind: ExampleKind;
	docs: string;
	input: Record<string, unknown>;
	module?: string;
	code?: string;
	visual?: boolean;
	request?: {
		url: string;
		auth?: { type: 'bearer' | 'header' | 'query' | 'basic'; name?: string; prefix?: string };
		headers?: Record<string, string>;
		params?: Record<string, string>;
		accountUrl?: string;
	};
};
export type Recipe = [title: string, input: Record<string, unknown>, code: string, description?: string];
export const slug = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
export function library(name: string, version: string, category: string, docs: string, recipes: Recipe[], visual = false): LibraryExample[] {
	return recipes.map(([title, input, code, description]) => ({
		id: `${slug(name)}-${slug(title)}`,
		provider: name,
		title,
		category,
		docs,
		input,
		code,
		description: description || `${title} with ${name}. Edit the sample input and run it to see the result.`,
		kind: visual ? 'component' : 'action',
		visual,
		module: `https://esm.sh/${name}@${version}?bundle`
	}));
}
