export const isMongoResultRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const displayMongoResultValue = (value: unknown) => {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const csvCell = (value: unknown) => {
  const displayed = displayMongoResultValue(value);
  // Spreadsheet programs can execute cells beginning with formula sigils even
  // when CSV fields are quoted. Prefix them with an apostrophe so exports stay
  // inert when opened in Excel, Numbers, or Google Sheets.
  const inert = /^[\t\r ]*[=+\-@]/.test(displayed) ? `'${displayed}` : displayed;
  return `"${inert.replace(/"/g, '""')}"`;
};

export const tabulateMongoResults = (results: unknown[]) => {
  const rows = results.map((value) => (isMongoResultRecord(value) ? value : { value }));
  const found = new Set<string>();
  for (const row of rows) Object.keys(row).forEach((key) => found.add(key));
  return { rows, columns: Array.from(found) };
};

export const serializeMongoResultsCsv = (results: unknown[]) => {
  const { rows, columns } = tabulateMongoResults(results);
  if (!columns.length) return '';
  return [
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))
  ].join('\n');
};
