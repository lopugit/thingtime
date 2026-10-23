import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { serializeMongoResultsCsv, tabulateMongoResults } from './resultExport.ts';

test('CSV exports neutralize spreadsheet formulas', () => {
  assert.equal(serializeMongoResultsCsv(['=HYPERLINK("https://example.test")']), '"value"\n"\'=HYPERLINK(""https://example.test"")"');
  assert.equal(serializeMongoResultsCsv([{ name: ' @SUM(1,2)' }]), '"name"\n"\' @SUM(1,2)"');
});

test('tabular exports retain primitive values and every returned field', () => {
  assert.deepEqual(tabulateMongoResults([42]), { rows: [{ value: 42 }], columns: ['value'] });

  const wide = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`field${index + 1}`, index + 1]));
  const csv = serializeMongoResultsCsv([wide]);
  assert.match(csv, /"field13"/);
  assert.match(csv, /"13"$/);
});
