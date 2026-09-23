export type Feature = {
	id: string;
	language: 'html' | 'css' | 'javascript' | 'webapi';
	kind: string;
	name: string;
	group: string;
	spec: string;
	status: string;
	references: string[];
	description?: string;
	syntax?: string;
	initial?: string;
	section?: string;
	interface?: string;
	member?: string;
	static?: boolean;
	readonly?: boolean;
	returns?: string;
	arguments?: { name: string; type: string; optional: boolean; variadic: boolean }[];
};
export type PlatformNode = string | { tag: string; attributes?: Record<string, string | number | boolean>; children?: PlatformNode[] };
export type PlatformExpression = { op: string; [key: string]: unknown };
export type PlatformProgram = {
	version: 1;
	title: string;
	description?: string;
	parameters?: { name: string; label: string; type: 'text' | 'number' | 'boolean' | 'json'; default: unknown }[];
	document?: PlatformNode[];
	styles?: { selector?: string; declarations?: Record<string, string>; rule?: string }[];
	steps?: PlatformExpression[];
	// DOM operations are a bounded vocabulary. JavaScript is compiled from data
	// to an isolated, terminable worker; it never executes in the account origin.
	dom?: { target: string; event?: string; method: string; args?: unknown[] }[];
	probe?: { kind: 'element' | 'attribute' | 'css' | 'selector' | 'interface'; name: string; value?: string; target?: string };
};
export type Recipe = { program: PlatformProgram; coverage: 'interactive' | 'inspection' | 'requires-context'; note: string };
