// ⌨️ Cmd/Ctrl+K opens the Commander from anywhere (claude-todo/10). Because the
// listener is an app-wide window keydown that preventDefault()s, "anywhere" has
// to answer one question the TODO left open: what wins when the caret already
// sits in a surface that binds CMD+K itself?
//
// Editor.js does — CMD+K is its core `link` inline tool, which is always on
// (see LongTextEditor.tsx). Unguarded, both fire: the link input opens AND the
// Commander steals focus mid-insertion, leaving a half-open link field behind.
// So inside an Editor.js block the editor wins.
//
// Everything else keeps the shortcut: login/search fields, comment boxes and
// the Thingtime tree bind nothing on Cmd+K, and the Commander's own <input>
// isn't inside an editor either — so Cmd+K still toggles the palette closed.
// Reverting this decision is one call site: drop the targetOwnsCommanderChord
// check in shouldToggleCommanderFromKeydown.
//
// DOM-free by construction — each predicate takes only the event shape it
// needs, so commanderShortcut.test.ts runs in plain Node.

/** Editor.js's holder class — the same root LongTextEditor's own styles target. */
const EDITOR_JS_ROOT_SELECTOR = '.codex-editor';

/**
 * `event.target` is typed `EventTarget`, which has no `closest` — and at
 * runtime it can be `window`/`document`, which really don't. Accept anything
 * and probe for the method.
 */
type MaybeClosestTarget = { closest?: (selector: string) => unknown } | null | undefined;

export type CommanderChordEvent = {
	key?: string;
	code?: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
};

/**
 * Cmd+K / Ctrl+K exactly — never Cmd+Alt+K or Cmd+Shift+K, which belong to
 * other shortcuts. `code` is the layout-independent physical key; `key` is the
 * fallback for events that omit it (synthetic dispatches, older browsers).
 */
export const isCommanderChord = (event: CommanderChordEvent | null | undefined): boolean => {
	if (!event) return false;
	if (!(event.metaKey || event.ctrlKey)) return false;
	if (event.altKey || event.shiftKey) return false;
	return event.code === 'KeyK' || event.key?.toLowerCase?.() === 'k';
};

/** True when the keydown happened inside a surface that binds CMD+K itself. */
export const targetOwnsCommanderChord = (target: MaybeClosestTarget): boolean => {
	if (typeof target?.closest !== 'function') return false;
	return Boolean(target.closest(EDITOR_JS_ROOT_SELECTOR));
};

/** The whole rule: is this the chord, and is the palette allowed to take it? */
export const shouldToggleCommanderFromKeydown = (
	event: (CommanderChordEvent & { target?: MaybeClosestTarget }) | null | undefined
): boolean => {
	if (!isCommanderChord(event)) return false;
	return !targetOwnsCommanderChord(event?.target);
};
