/** Compact decimal units. Keep the raw byte count separately for inspection. */
export function formatByteSize(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit += 1;
  }
  const precision = unit === 0 ? 0 : 2;
  const rounded = Math.round(size * 10 ** precision) / 10 ** precision;
  if (rounded >= 1000 && unit < units.length - 1) return `1 ${units[unit + 1]}`;
  return `${rounded.toLocaleString('en-US', { maximumFractionDigits: precision })} ${units[unit]}`;
}
