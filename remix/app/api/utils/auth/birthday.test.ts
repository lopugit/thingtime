import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { sanitizeBirthday } from './birthday.ts';

const TODAY = new Date('2026-08-07T12:00:00Z');

test('valid dates pass through trimmed', () => {
  assert.equal(sanitizeBirthday('1990-04-23', TODAY), '1990-04-23');
  assert.equal(sanitizeBirthday('  2000-12-31  ', TODAY), '2000-12-31');
  assert.equal(sanitizeBirthday('2026-08-07', TODAY), '2026-08-07'); // today is allowed
});

test('null and empty clear the birthday', () => {
  assert.equal(sanitizeBirthday(null, TODAY), null);
  assert.equal(sanitizeBirthday('', TODAY), null);
  assert.equal(sanitizeBirthday('   ', TODAY), null);
});

test('non-strings are invalid', () => {
  assert.equal(sanitizeBirthday(19900423, TODAY), undefined);
  assert.equal(sanitizeBirthday({ birthday: '1990-04-23' }, TODAY), undefined);
  assert.equal(sanitizeBirthday(true, TODAY), undefined);
});

test('malformed shapes are invalid', () => {
  assert.equal(sanitizeBirthday('23-04-1990', TODAY), undefined);
  assert.equal(sanitizeBirthday('1990/04/23', TODAY), undefined);
  assert.equal(sanitizeBirthday('1990-4-23', TODAY), undefined);
  assert.equal(sanitizeBirthday('1990-04-23T00:00:00Z', TODAY), undefined);
});

test('impossible calendar dates are invalid (no rollover)', () => {
  assert.equal(sanitizeBirthday('2001-02-31', TODAY), undefined);
  assert.equal(sanitizeBirthday('1999-13-01', TODAY), undefined);
  assert.equal(sanitizeBirthday('1999-00-10', TODAY), undefined);
  assert.equal(sanitizeBirthday('2023-02-29', TODAY), undefined); // not a leap year
  assert.equal(sanitizeBirthday('2024-02-29', TODAY), '2024-02-29'); // leap year
});

test('bounds: before 1900 or after today are invalid', () => {
  assert.equal(sanitizeBirthday('1899-12-31', TODAY), undefined);
  assert.equal(sanitizeBirthday('1900-01-01', TODAY), '1900-01-01');
  assert.equal(sanitizeBirthday('2026-08-08', TODAY), undefined); // tomorrow
});
