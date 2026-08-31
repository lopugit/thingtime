import { describe, expect, it } from 'vitest';

import { unescapeRegexReplacementText } from '../extensions/raycast/src/commands/regexToReplacementConverter';

describe('unescapeRegexReplacementText', () => {
  it.each([
    [String.raw`\{value\}`, '{value}'],
    [String.raw`\[value\]`, '[value]'],
    [String.raw`value\.txt`, 'value.txt'],
    [String.raw`\\`, '\\'],
  ])('decodes supported replacement escape %s', (input, expected) => {
    expect(unescapeRegexReplacementText(input)).toBe(expected);
  });

  it('preserves unsupported escapes', () => {
    expect(unescapeRegexReplacementText(String.raw`\q`)).toBe(String.raw`\q`);
  });

  it('does not decode a backslash produced by an earlier escape', () => {
    expect(unescapeRegexReplacementText(String.raw`\\\.`)).toBe(String.raw`\.`);
    expect(unescapeRegexReplacementText(String.raw`\\\{`)).toBe(String.raw`\{`);
  });
});
