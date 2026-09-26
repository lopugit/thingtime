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
export type PlatformBooleanInput = boolean | { op: 'input'; name: string };
export type PlatformDOMBinding = {
	target: string;
	event?: string;
	method?: string;
	/** A registered native media property. Omit value to read; provide it to write. */
	property?: string;
	value?: string | number | boolean | { op: 'input'; name: string };
	args?: unknown[];
	label?: string;
	/** IDL handler properties have native replacement and return-false semantics. */
	binding?: 'listener' | 'handler';
	options?: { capture?: PlatformBooleanInput; once?: PlatformBooleanInput; passive?: PlatformBooleanInput };
	preventDefault?: PlatformBooleanInput;
	stopPropagation?: PlatformBooleanInput;
	stopImmediatePropagation?: PlatformBooleanInput;
	returnFalse?: PlatformBooleanInput;
};
/** Native destructuring authoring. A string is a binding identifier; expression
 * references are accepted only in assignment patterns. Rest is a separate last
 * target, and null array entries represent elisions. */
export type PlatformPattern =
	| string
	| { op: 'array-pattern'; items: (PlatformPattern | null)[]; rest?: PlatformPattern }
	| { op: 'object-pattern'; entries: { key: unknown; computed?: boolean; target: PlatformPattern }[]; rest?: PlatformPattern }
	| { op: 'default-pattern'; target: PlatformPattern; value: unknown }
	| PlatformExpression;
export type PlatformProgram = {
	version: 1;
	title: string;
	description?: string;
	parameters?: { name: string; label: string; type: 'text' | 'number' | 'boolean' | 'json'; default: unknown }[];
	/** Enables native form validation/submit events in the opaque frame.
	 * Navigation remains canceled and denied by the runtime's form-action CSP. */
	allowFormEvents?: boolean;
	document?: PlatformNode[];
	styles?: { selector?: string; declarations?: Record<string, string>; rule?: string }[];
	steps?: PlatformExpression[];
	/** Availability hints, checked in the worker without invoking accessors. */
	requires?: string[][];
	// DOM operations are a bounded vocabulary. JavaScript is compiled from data
	// to an isolated, terminable worker; it never executes in the account origin.
	/** Omit method to observe a real event. A top-level {op: 'element', selector}
	 * argument references an element inside this program's rendered surface. */
	dom?: PlatformDOMBinding[];
	probe?: { kind: 'element' | 'attribute' | 'css' | 'selector' | 'interface'; name: string; value?: string; target?: string };
};
export type Recipe = { program: PlatformProgram; coverage: 'interactive' | 'inspection' | 'requires-context'; note: string };
