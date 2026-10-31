import { describe, expect, it } from 'vitest';
import type { SystemProcessMetric } from '@commander/protocol';
import {
  defaultProcessPreferences,
  matchesProcessFilter,
  selectProcesses,
  type ProcessFilter,
} from './processModel.js';
const process = (pid: number, name: string, cpu: number): SystemProcessMetric => ({
  pid,
  name,
  parentPid: 1,
  cpuPercent: cpu,
  residentMemoryBytes: 2 * 1024 ** 3,
  diskReadBytesPerSecond: 1024,
  diskWriteBytesPerSecond: 0,
});
const a = process(3, 'Alpha', 90);
const b = process(2, 'Beta', 10);
const filter = (patch: Partial<ProcessFilter>): ProcessFilter => ({
  id: 'one',
  column: 'cpu',
  operator: 'gte',
  value: '20',
  scale: 1,
  ...patch,
});
describe('process selection', () => {
  it('keeps name and PID ordering across usage changes and incoming order changes', () => {
    const twin = process(8, 'Alpha', 0);
    expect(selectProcesses([twin, b, a], defaultProcessPreferences).map((p) => p.pid)).toEqual([3, 8, 2]);
    expect(
      selectProcesses(
        [{ ...b, cpuPercent: 99 }, { ...a, cpuPercent: 0 }, twin],
        defaultProcessPreferences,
      ).map((p) => p.pid),
    ).toEqual([3, 8, 2]);
  });
  it('sorts and filters with selected averages instead of current values; unknown averages stay last', () => {
    const averaged = [a, b].map((p, i) => ({
      ...p,
      average: { ...p, cpuPercent: i ? 80 : 2, observedSeconds: 20 },
    }));
    const preferences = {
      ...defaultProcessPreferences,
      sort: 'cpu' as const,
      direction: 'descending' as const,
      averageSeconds: 300,
    };
    expect(selectProcesses([process(4, 'Missing', 100), ...averaged], preferences).map((p) => p.pid)).toEqual(
      [2, 3, 4],
    );
    expect(selectProcesses(averaged, { ...preferences, filters: [filter({})] }).map((p) => p.pid)).toEqual([
      2,
    ]);
  });
  it('supports text, numeric and byte units, conjunctions, and availability without treating missing as zero', () => {
    expect(
      matchesProcessFilter(a, filter({ column: 'name', operator: 'contains', value: 'ALP' }), false),
    ).toBe(true);
    expect(
      matchesProcessFilter(a, filter({ column: 'memory', value: '2048', scale: 1024 ** 2 }), false),
    ).toBe(true);
    expect(matchesProcessFilter(a, filter({ column: 'gpu', operator: 'eq', value: '0' }), false)).toBe(false);
    expect(matchesProcessFilter(a, filter({ column: 'gpu', operator: 'unavailable' }), false)).toBe(true);
    expect(
      selectProcesses([a, b], {
        ...defaultProcessPreferences,
        filters: [filter({}), filter({ column: 'pid', operator: 'eq', value: '2' })],
      }),
    ).toEqual([]);
  });
  it('orders parent groups by parent PID regardless of usage sort', () => {
    const rows = selectProcesses([{ ...a, parentPid: 40 }, b], {
      ...defaultProcessPreferences,
      groupByParent: true,
      sort: 'cpu',
      direction: 'descending',
    });
    expect(rows.map((p) => p.parentPid)).toEqual([1, 40]);
  });
});
