import type { SystemProcessMetric } from '@commander/protocol';

export const processColumns = {
  name: { label: 'Name', type: 'text' },
  pid: { label: 'PID', type: 'number' },
  parent: { label: 'Parent PID', type: 'number' },
  cpu: { label: 'CPU', type: 'percent' },
  gpu: { label: 'GPU', type: 'percent' },
  memory: { label: 'Memory', type: 'bytes' },
  network: { label: 'Network', type: 'rate' },
  disk: { label: 'Disk', type: 'rate' },
  diskRead: { label: 'Disk read', type: 'rate' },
  diskWrite: { label: 'Disk write', type: 'rate' },
} as const;
export type ProcessColumn = keyof typeof processColumns;
export type ProcessFilter = {
  id: string;
  column: ProcessColumn;
  operator: 'contains' | 'notContains' | 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'available' | 'unavailable';
  value: string;
  scale: number;
};
export const averageWindows = [
  [0, 'Current'],
  [300, '5 minutes'],
  [600, '10 minutes'],
  [1800, '30 minutes'],
  [3600, '1 hour'],
  [10800, '3 hours'],
  [21600, '6 hours'],
  [43200, '12 hours'],
  [86400, '1 day'],
] as const;
export type ProcessPreferences = {
  sort: ProcessColumn;
  direction: 'ascending' | 'descending';
  averageSeconds: number;
  groupByParent: boolean;
  filters: ProcessFilter[];
};
export const defaultProcessPreferences: ProcessPreferences = {
  sort: 'name',
  direction: 'ascending',
  averageSeconds: 0,
  groupByParent: false,
  filters: [],
};
export function processValue(
  process: SystemProcessMetric,
  column: ProcessColumn,
  average: boolean,
): string | number | undefined {
  const usage = average ? process.average : process;
  switch (column) {
    case 'name':
      return process.name;
    case 'pid':
      return process.pid;
    case 'parent':
      return process.parentPid;
    case 'cpu':
      return usage?.cpuPercent;
    case 'gpu':
      return usage?.gpuPercent;
    case 'memory':
      return usage?.residentMemoryBytes;
    case 'network':
      return usage?.networkBytesPerSecond;
    case 'diskRead':
      return usage?.diskReadBytesPerSecond;
    case 'diskWrite':
      return usage?.diskWriteBytesPerSecond;
    case 'disk':
      return usage ? usage.diskReadBytesPerSecond + usage.diskWriteBytesPerSecond : undefined;
  }
}
export function matchesProcessFilter(
  process: SystemProcessMetric,
  filter: ProcessFilter,
  average: boolean,
): boolean {
  const actual = processValue(process, filter.column, average);
  if (filter.operator === 'available') return actual !== undefined;
  if (filter.operator === 'unavailable') return actual === undefined;
  if (!filter.value.trim()) return true;
  if (actual === undefined) return false;
  if (typeof actual === 'string') {
    const left = actual.toLocaleLowerCase();
    const right = filter.value.toLocaleLowerCase();
    return filter.operator === 'eq'
      ? left === right
      : filter.operator === 'notContains'
        ? !left.includes(right)
        : left.includes(right);
  }
  const expected = Number(filter.value) * filter.scale;
  if (!Number.isFinite(expected)) return false;
  switch (filter.operator) {
    case 'eq':
      return actual === expected;
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
    default:
      return false;
  }
}
export function selectProcesses(
  processes: readonly SystemProcessMetric[],
  preferences: ProcessPreferences,
): SystemProcessMetric[] {
  const average = preferences.averageSeconds > 0;
  return processes
    .filter((process) =>
      preferences.filters.every((filter) => matchesProcessFilter(process, filter, average)),
    )
    .sort((left, right) => {
      if (preferences.groupByParent && left.parentPid !== right.parentPid)
        return left.parentPid - right.parentPid;
      const a = processValue(left, preferences.sort, average);
      const b = processValue(right, preferences.sort, average);
      if (a === undefined && b !== undefined) return 1;
      if (b === undefined && a !== undefined) return -1;
      const comparison =
        typeof a === 'string' && typeof b === 'string'
          ? a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
          : typeof a === 'number' && typeof b === 'number'
            ? a - b
            : 0;
      return (
        comparison * (preferences.direction === 'ascending' ? 1 : -1) ||
        left.name.localeCompare(right.name, undefined, { numeric: true }) ||
        left.pid - right.pid
      );
    });
}
export function formatProcessValue(value: string | number | undefined, column: ProcessColumn): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  const type = processColumns[column].type;
  if (type === 'percent') return `${value.toFixed(1)}%`;
  if (type === 'bytes' || type === 'rate') {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index++;
    }
    return `${value.toFixed(index ? 1 : 0)} ${units[index]}${type === 'rate' ? '/s' : ''}`;
  }
  return String(value);
}
