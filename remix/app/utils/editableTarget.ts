// "Is the user typing right now?" — the guard every app-wide keydown listener
// needs before it calls preventDefault().
//
// The bug class this kills: a window-level shortcut that swallows a keystroke
// while the caret is inside a text field. Cmd/Ctrl+Z is the worst of them —
// hijacking it mutates unrelated thingtime state while the user is just trying
// to fix a typo, and the native text undo they expected never runs.
//
// Kept DOM-shaped (duck-typed, not `instanceof HTMLElement`) so it is callable
// against an `EventTarget`, `document`, `null`, or a plain test double without
// a jsdom environment.

type MaybeEditable = {
  tagName?: unknown;
  isContentEditable?: unknown;
} | null;

// Form controls whose own key handling must always win over a global shortcut.
// SELECT is included because type-ahead selection is keyboard text entry too.
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// True when `target` is a field the browser is editing: a form control, or
// anything inside a contentEditable region (Editor.js blocks report
// `isContentEditable` on descendants too, so this covers a caret nested deep
// inside a block).
export const isEditableTarget = (target: unknown): boolean => {
  const node = target as MaybeEditable;
  if (!node || typeof node !== 'object') return false;
  if (typeof node.tagName === 'string' && EDITABLE_TAGS.has(node.tagName)) return true;
  return node.isContentEditable === true;
};

// True when a global keydown handler must keep its hands off the event.
// Adds IME composition to the editable check: mid-composition (Japanese,
// Chinese, Korean input) the keystrokes belong to the input method, and
// `isComposing` is the only signal that the visible target is not the whole
// story.
export const shouldIgnoreGlobalKeydown = (event: {
  target?: unknown;
  isComposing?: unknown;
} | null | undefined): boolean => {
  if (!event) return false;
  return isEditableTarget(event.target) || event.isComposing === true;
};
