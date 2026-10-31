const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Tab: 'Tab',
  Backspace: 'Delete',
  Delete: 'ForwardDelete',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
};

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  const modifiers = [
    event.metaKey ? 'Command' : '',
    event.ctrlKey ? 'Control' : '',
    event.altKey ? 'Option' : '',
    event.shiftKey ? 'Shift' : '',
  ].filter(Boolean);
  if (!modifiers.length) return null;

  const key =
    CODE_KEYS[event.code] ??
    (/^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3)
      : /^Digit\d$/.test(event.code)
        ? event.code.slice(5)
        : /^F(?:[1-9]|1\d|20)$/.test(event.code)
          ? event.code
          : event.key.length === 1
            ? event.key.toUpperCase()
            : '');
  return key ? [...modifiers, key].join('+') : null;
}

export function formatShortcut(shortcut: string): string {
  return shortcut
    .replaceAll('Command', '⌘')
    .replaceAll('Option', '⌥')
    .replaceAll('Control', '⌃')
    .replaceAll('Shift', '⇧')
    .replaceAll('+', ' ');
}

export function clearsRecordedShortcut(event: KeyboardEvent): boolean {
  return (
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === 'Backspace' || event.key === 'Delete')
  );
}

export function shortcutMatchesKeyboardEvent(shortcut: string, event: KeyboardEvent): boolean {
  const parts = new Set(
    shortcut
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const expectedKey = [...parts].find((part) => !['Command', 'Control', 'Option', 'Shift'].includes(part));
  if (!expectedKey) return false;
  if (event.metaKey !== parts.has('Command')) return false;
  if (event.ctrlKey !== parts.has('Control')) return false;
  if (event.altKey !== parts.has('Option')) return false;
  if (event.shiftKey !== parts.has('Shift')) return false;
  return shortcutEventKey(event) === expectedKey.toUpperCase();
}

function shortcutEventKey(event: KeyboardEvent): string {
  return (
    CODE_KEYS[event.code] ??
    (/^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3)
      : /^Digit\d$/.test(event.code)
        ? event.code.slice(5)
        : event.key.length === 1
          ? event.key.toUpperCase()
          : event.key)
  ).toUpperCase();
}
