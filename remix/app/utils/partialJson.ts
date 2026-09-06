// Tolerant JSON parser for STREAMED documents. A model streams a tool input
// (or a fenced tt-tool block) token by token, so at any instant the buffer is
// a valid JSON prefix: open strings, open arrays, open objects, a dangling
// key, a half-typed literal. `parsePartialJson` parses as much as the prefix
// pins down and closes everything still open, so the client can preview a
// component render / a page's ops while the model is still writing.
//
// Isomorphic (no Node imports): the chat bubble's live preview and the server
// executor share it. Rules:
//   - a complete document parses exactly like JSON.parse (complete: true)
//   - an open string yields the characters received so far (a trailing
//     incomplete escape sequence is dropped)
//   - a dangling object key with no value yet is dropped; a key with a `:`
//     but no value yet is dropped too (never invented as null)
//   - a truncated literal resolves by its unambiguous first letter (t → true,
//     f → false, n → null); a truncated number keeps its parsed prefix
//   - trailing commas are tolerated
//   - anything that is not a JSON prefix (`{,`, `]`, letters) stops the parse
//     at the last consistent point — the value parsed so far is returned and
//     `complete` is false, never a throw

export type PartialJsonResult = { value: unknown; complete: boolean };

const WHITESPACE = new Set([' ', '\n', '\r', '\t']);

type Cursor = { text: string; pos: number; truncated: boolean };

const skipWhitespace = (cursor: Cursor): void => {
  while (cursor.pos < cursor.text.length && WHITESPACE.has(cursor.text[cursor.pos])) cursor.pos += 1;
};

const atEnd = (cursor: Cursor): boolean => cursor.pos >= cursor.text.length;

// Returns undefined when the string is malformed at a point that is not simply
// "cut off" (never happens for a real JSON prefix). `truncated` is flagged when
// the closing quote has not arrived yet.
const parseString = (cursor: Cursor): string | undefined => {
  // cursor sits on the opening quote
  cursor.pos += 1;
  let out = '';
  for (;;) {
    if (atEnd(cursor)) {
      cursor.truncated = true;
      return out;
    }
    const ch = cursor.text[cursor.pos];
    if (ch === '"') {
      cursor.pos += 1;
      return out;
    }
    if (ch === '\\') {
      const next = cursor.text[cursor.pos + 1];
      if (next === undefined) {
        // dangling backslash: the escape has not streamed yet
        cursor.truncated = true;
        cursor.pos += 1;
        return out;
      }
      if (next === 'u') {
        const hex = cursor.text.slice(cursor.pos + 2, cursor.pos + 6);
        if (hex.length < 4) {
          cursor.truncated = true;
          cursor.pos = cursor.text.length;
          return out;
        }
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return undefined;
        out += String.fromCharCode(parseInt(hex, 16));
        cursor.pos += 6;
        continue;
      }
      const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (!(next in simple)) return undefined;
      out += simple[next];
      cursor.pos += 2;
      continue;
    }
    out += ch;
    cursor.pos += 1;
  }
};

const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

const parseNumber = (cursor: Cursor): number | undefined => {
  const rest = cursor.text.slice(cursor.pos);
  const match = NUMBER_PATTERN.exec(rest);
  if (!match) {
    // a lone "-" / "1." / "1e" prefix: the number is still streaming
    const partial = /^-?\d*\.?\d*(?:[eE][+-]?)?/.exec(rest);
    if (partial && partial[0].length === rest.length && partial[0].length > 0) {
      cursor.truncated = true;
      cursor.pos = cursor.text.length;
      const digits = /^-?\d+(?:\.\d+)?/.exec(rest);
      return digits ? Number(digits[0]) : undefined;
    }
    return undefined;
  }
  const consumed = match[0];
  // the match may itself be a prefix of a longer number still streaming
  // ("12" of "123", "1.5" of "1.55") — only when it ends the buffer
  if (consumed.length === rest.length) cursor.truncated = true;
  else {
    const tail = rest[consumed.length];
    if (tail === '.' || tail === 'e' || tail === 'E' || tail === '-' || tail === '+') {
      // "1." / "1e" / "1e-" with nothing after: streaming
      const partialTail = /^(?:\.\d*|[eE][+-]?\d*)$/.exec(rest.slice(consumed.length));
      if (partialTail) {
        cursor.truncated = true;
        cursor.pos = cursor.text.length;
        return Number(consumed);
      }
    }
  }
  cursor.pos += consumed.length;
  return Number(consumed);
};

const LITERALS: Array<[string, unknown]> = [
  ['true', true],
  ['false', false],
  ['null', null]
];

const parseLiteral = (cursor: Cursor): unknown => {
  const rest = cursor.text.slice(cursor.pos);
  for (const [word, value] of LITERALS) {
    if (rest.startsWith(word)) {
      cursor.pos += word.length;
      return value;
    }
    if (word.startsWith(rest)) {
      // an unambiguous truncated literal ("tr", "fa", "nu")
      cursor.truncated = true;
      cursor.pos = cursor.text.length;
      return value;
    }
  }
  return undefined;
};

// Sentinel for "nothing parseable here" (distinct from a parsed `undefined`,
// which JSON cannot express anyway).
const NOTHING = Symbol('nothing');

const parseValue = (cursor: Cursor, depth: number): unknown | typeof NOTHING => {
  skipWhitespace(cursor);
  if (atEnd(cursor)) {
    cursor.truncated = true;
    return NOTHING;
  }
  if (depth > 512) return NOTHING;
  const ch = cursor.text[cursor.pos];
  if (ch === '{') return parseObject(cursor, depth + 1);
  if (ch === '[') return parseArray(cursor, depth + 1);
  if (ch === '"') {
    const value = parseString(cursor);
    return value === undefined ? NOTHING : value;
  }
  if (ch === '-' || (ch >= '0' && ch <= '9')) {
    const value = parseNumber(cursor);
    return value === undefined ? NOTHING : value;
  }
  if (ch === 't' || ch === 'f' || ch === 'n') {
    const value = parseLiteral(cursor);
    return value === undefined ? NOTHING : value;
  }
  return NOTHING;
};

const parseObject = (cursor: Cursor, depth: number): Record<string, unknown> => {
  cursor.pos += 1; // '{'
  const out: Record<string, unknown> = {};
  for (;;) {
    skipWhitespace(cursor);
    if (atEnd(cursor)) {
      cursor.truncated = true;
      return out;
    }
    const ch = cursor.text[cursor.pos];
    if (ch === '}') {
      cursor.pos += 1;
      return out;
    }
    if (ch === ',') {
      cursor.pos += 1;
      continue;
    }
    if (ch !== '"') {
      // not a JSON prefix — stop at the last consistent point
      cursor.truncated = true;
      cursor.pos = cursor.text.length;
      return out;
    }
    const key = parseString(cursor);
    if (key === undefined || cursor.truncated) {
      // a dangling / half-streamed key is never materialised
      cursor.truncated = true;
      cursor.pos = cursor.text.length;
      return out;
    }
    skipWhitespace(cursor);
    if (atEnd(cursor)) {
      cursor.truncated = true;
      return out;
    }
    if (cursor.text[cursor.pos] !== ':') {
      cursor.truncated = true;
      cursor.pos = cursor.text.length;
      return out;
    }
    cursor.pos += 1;
    const value = parseValue(cursor, depth);
    if (value === NOTHING) {
      cursor.truncated = true;
      cursor.pos = cursor.text.length;
      return out;
    }
    if (key !== '__proto__') out[key] = value;
    if (cursor.truncated) {
      cursor.pos = cursor.text.length;
      return out;
    }
  }
};

const parseArray = (cursor: Cursor, depth: number): unknown[] => {
  cursor.pos += 1; // '['
  const out: unknown[] = [];
  for (;;) {
    skipWhitespace(cursor);
    if (atEnd(cursor)) {
      cursor.truncated = true;
      return out;
    }
    const ch = cursor.text[cursor.pos];
    if (ch === ']') {
      cursor.pos += 1;
      return out;
    }
    if (ch === ',') {
      cursor.pos += 1;
      continue;
    }
    const value = parseValue(cursor, depth);
    if (value === NOTHING) {
      cursor.truncated = true;
      cursor.pos = cursor.text.length;
      return out;
    }
    out.push(value);
    if (cursor.truncated) {
      cursor.pos = cursor.text.length;
      return out;
    }
  }
};

export const parsePartialJson = (text: string): PartialJsonResult => {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return { value: undefined, complete: false };
  // the fast path IS the spec for complete documents
  try {
    return { value: JSON.parse(source), complete: true };
  } catch {
    // fall through to the tolerant parse
  }
  const cursor: Cursor = { text: source, pos: 0, truncated: false };
  const value = parseValue(cursor, 0);
  if (value === NOTHING) return { value: undefined, complete: false };
  skipWhitespace(cursor);
  // JSON.parse failed, so by construction something was open or trailing —
  // a tolerant parse is never reported as complete
  return { value, complete: false };
};
