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
