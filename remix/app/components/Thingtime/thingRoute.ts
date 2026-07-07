// Single source of truth for how URL pathnames map to a thing path + mode.
// The root catch-all route renders <ThingtimeURL/>; these helpers keep the
// drawer, ThingtimeURL, and anything else that builds mode links on one code
// path so "switch mode" always preserves the current thing path.

export type ThingMode = 'view' | 'edit' | 'editor';

export const ROOT_THING_PATH = 'thingtime';

// first URL segment -> mode. 'things' is the canonical view prefix.
const MODE_SEGMENTS: Record<string, ThingMode> = {
	things: 'view',
	edit: 'edit',
	editor: 'editor'
};

export const THING_MODE_PREFIXES: Record<ThingMode, string> = {
	view: '/things',
	edit: '/edit',
	editor: '/editor'
};

const splitSegments = (pathname?: string): string[] => {
	return (pathname || '').split('/').filter(Boolean);
};

// '/editor/foo' -> 'editor', '/edit/foo' -> 'edit', everything else -> 'view'
export const parseThingMode = (pathname?: string): ThingMode => {
	const first = splitSegments(pathname)[0];
	return (first && MODE_SEGMENTS[first]) || 'view';
};

// '/edit/foo' -> 'foo', '/things/foo' -> 'foo', '/foo' -> 'foo',
// '/edit' | '/things' | '/' -> ROOT_THING_PATH.
// Nested slashes inside the thing segment become dots ('a/b' -> 'a.b').
export const parseThingPath = (pathname?: string): string => {
	const segments = splitSegments(pathname);
	const first = segments[0];

	if (first && MODE_SEGMENTS[first]) {
		return segments[1]?.replace(/\//g, '.') || ROOT_THING_PATH;
	}

	// legacy shape kept from ThingtimeURL: '/<anything>/<thing>' reads the
	// second segment first, then falls back to the first
	const segment = segments[1] || segments[0];

	return segment?.replace(/\//g, '.') || ROOT_THING_PATH;
};

// build the URL for a mode + thing path; the root thing path collapses to the
// bare mode prefix ('/things', '/edit', '/editor')
export const buildThingModeUrl = (mode: ThingMode, thingPath?: string): string => {
	const prefix = THING_MODE_PREFIXES[mode];

	if (!thingPath || thingPath === ROOT_THING_PATH) {
		return prefix;
	}

	return `${prefix}/${thingPath}`;
};
