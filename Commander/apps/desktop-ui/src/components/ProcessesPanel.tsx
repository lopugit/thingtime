import { Fragment, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Plus, Rows3, X } from 'lucide-react';
import type { SystemProcessMetric } from '@commander/protocol';
import { nativeRequest } from '../lib/nativeBridge.js';
import {
  averageWindows,
  defaultProcessPreferences,
  formatProcessValue,
  processColumns,
  processValue,
  selectProcesses,
  type ProcessColumn,
  type ProcessFilter,
  type ProcessPreferences,
} from './processModel.js';

const preferenceKey = 'commander.process-view.v1';
function readPreferences(): ProcessPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null') as ProcessPreferences | null;
    if (
      !value ||
      !Object.hasOwn(processColumns, value.sort) ||
      !['ascending', 'descending'].includes(value.direction) ||
      !averageWindows.some(([seconds]) => seconds === value.averageSeconds) ||
      typeof value.groupByParent !== 'boolean' ||
      !Array.isArray(value.filters) ||
      !value.filters.every(
        (filter) =>
          filter &&
          typeof filter.id === 'string' &&
          Object.hasOwn(processColumns, filter.column) &&
          ['contains', 'notContains', 'eq', 'gt', 'gte', 'lt', 'lte', 'available', 'unavailable'].includes(
            filter.operator,
          ) &&
          typeof filter.value === 'string' &&
          [1, 1024, 1048576, 1073741824].includes(filter.scale),
      )
    )
      return defaultProcessPreferences;
    return value;
  } catch {
    return defaultProcessPreferences;
  }
}
export function useProcessPreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    const reload = (event: StorageEvent) => {
      if (event.key === preferenceKey) setPreferences(readPreferences());
    };
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, []);
  const save = (next: ProcessPreferences) => {
    setPreferences(next);
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(next));
    } catch {
      /* Still usable in memory. */
    }
  };
  return [preferences, save] as const;
}
const visibleColumns: ProcessColumn[] = ['name', 'parent', 'cpu', 'gpu', 'memory', 'network', 'disk'];
export function ProcessesPanel({
  processes,
  preferences,
  onPreferencesChange,
  onError,
  detached = false,
}: {
  processes: SystemProcessMetric[];
  preferences: ProcessPreferences;
  onPreferencesChange(next: ProcessPreferences): void;
  onError(message: string | null): void;
  detached?: boolean;
}) {
  const rows = useMemo(() => selectProcesses(processes, preferences), [processes, preferences]);
  const average = preferences.averageSeconds > 0;
  const patch = (next: Partial<ProcessPreferences>) => onPreferencesChange({ ...preferences, ...next });
  const changeFilter = (id: string, next: Partial<ProcessFilter>) =>
    patch({
      filters: preferences.filters.map((filter) => (filter.id === id ? { ...filter, ...next } : filter)),
    });
  const sort = (column: ProcessColumn) =>
    patch({
      sort: column,
      direction:
        preferences.sort === column && preferences.direction === 'ascending' ? 'descending' : 'ascending',
    });
  const names = new Map(processes.map((process) => [process.pid, process.name]));
  return (
    <section className="activity-section activity-processes" aria-labelledby="process-usage-title">
      <div className="activity-section-heading">
        <div>
          <h3 id="process-usage-title">
            <Rows3 /> Processes
          </h3>
          <p>Live macOS processes. Name and PID ordering stays stable as usage updates.</p>
        </div>
        {!detached && (
          <button
            className="process-icon-button"
            type="button"
            title="Open Processes in its own window"
            aria-label="Open Processes in its own window"
            onClick={() => {
              void nativeRequest('processes.open').catch((error: unknown) =>
                onError(error instanceof Error ? error.message : 'Could not open Processes'),
              );
            }}
          >
            <ExternalLink aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="process-controls">
        <label>
          Sort by
          <select
            value={preferences.sort}
            onChange={(event) => patch({ sort: event.target.value as ProcessColumn })}
          >
            {Object.entries(processColumns).map(([key, column]) => (
              <option key={key} value={key}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Order
          <select
            value={preferences.direction}
            onChange={(event) => patch({ direction: event.target.value as ProcessPreferences['direction'] })}
          >
            <option value="ascending">Ascending</option>
            <option value="descending">Descending</option>
          </select>
        </label>
        <label>
          Average window
          <select
            value={preferences.averageSeconds}
            onChange={(event) => patch({ averageSeconds: Number(event.target.value) })}
          >
            {averageWindows.map(([seconds, label]) => (
              <option key={seconds} value={seconds}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="process-checkbox">
          <input
            type="checkbox"
            checked={preferences.groupByParent}
            onChange={(event) => patch({ groupByParent: event.target.checked })}
          />
          Group by parent
        </label>
        <button
          type="button"
          className="process-add-filter"
          onClick={() =>
            patch({
              filters: [
                ...preferences.filters,
                { id: crypto.randomUUID(), column: 'name', operator: 'contains', value: '', scale: 1 },
              ],
            })
          }
        >
          <Plus /> Add filter
        </button>
      </div>
      {preferences.filters.map((filter, index) => {
        const type = processColumns[filter.column].type;
        const operators =
          type === 'text'
            ? [
                ['contains', 'Contains'],
                ['notContains', 'Does not contain'],
                ['eq', 'Equals'],
              ]
            : [
                ['gt', 'Greater than'],
                ['gte', 'At least'],
                ['lt', 'Less than'],
                ['lte', 'At most'],
                ['eq', 'Equals'],
                ['available', 'Available'],
                ['unavailable', 'Unavailable'],
              ];
        const needsValue = !['available', 'unavailable'].includes(filter.operator);
        return (
          <div className="process-filter" key={filter.id}>
            <label>
              Column
              <select
                aria-label={`Filter ${index + 1} column`}
                value={filter.column}
                onChange={(event) => {
                  const column = event.target.value as ProcessColumn;
                  changeFilter(filter.id, {
                    column,
                    operator: column === 'name' ? 'contains' : 'gte',
                    value: '',
                    scale: 1,
                  });
                }}
              >
                {Object.entries(processColumns).map(([key, column]) => (
                  <option key={key} value={key}>
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Condition
              <select
                aria-label={`Filter ${index + 1} condition`}
                value={filter.operator}
                onChange={(event) =>
                  changeFilter(filter.id, { operator: event.target.value as ProcessFilter['operator'] })
                }
              >
                {operators.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {needsValue && (
              <label>
                Value
                <input
                  aria-label={`Filter ${index + 1} value`}
                  type={type === 'text' ? 'text' : 'number'}
                  step="any"
                  value={filter.value}
                  onChange={(event) => changeFilter(filter.id, { value: event.target.value })}
                />
              </label>
            )}
            {needsValue && (type === 'bytes' || type === 'rate') ? (
              <label>
                Units
                <select
                  aria-label={`Filter ${index + 1} units`}
                  value={filter.scale}
                  onChange={(event) => changeFilter(filter.id, { scale: Number(event.target.value) })}
                >
                  {['B', 'KiB', 'MiB', 'GiB'].map((unit, power) => (
                    <option key={unit} value={1024 ** power}>
                      {unit}
                      {type === 'rate' ? '/s' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : needsValue && type === 'percent' ? (
              <span>%</span>
            ) : null}
            <button
              type="button"
              className="process-icon-button"
              aria-label={`Remove filter ${index + 1}`}
              onClick={() => patch({ filters: preferences.filters.filter((item) => item.id !== filter.id) })}
            >
              <X />
            </button>
          </div>
        );
      })}
      <p className="process-sample-note">
        {rows.length} of {processes.length} processes ·{' '}
        {average
          ? 'Sampled averages use one-minute buckets collected while Activity or Processes is open. Hover a process for its observed history; gaps and unavailable values are excluded.'
          : 'Current usage. Choose an average window to smooth usage values, filtering and sorting.'}
      </p>
      <div className="activity-process-table-wrap">
        <table className="activity-process-table">
          <colgroup>
            {visibleColumns.map((column) => (
              <col key={column} style={{ width: column === 'name' ? '28%' : '12%' }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((column) => (
                <th key={column} aria-sort={preferences.sort === column ? preferences.direction : 'none'}>
                  <button type="button" onClick={() => sort(column)}>
                    {processColumns[column].label}
                    {preferences.sort === column ? (preferences.direction === 'ascending' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((process, index) => (
              <Fragment key={`${process.pid}:${process.startedAtMs ?? process.name}`}>
                {preferences.groupByParent &&
                  (index === 0 || rows[index - 1]?.parentPid !== process.parentPid) && (
                    <tr className="activity-process-group">
                      <td colSpan={visibleColumns.length}>
                        {names.get(process.parentPid) ?? 'Parent process'} ({process.parentPid})
                      </td>
                    </tr>
                  )}
                <tr
                  title={
                    average
                      ? `${Math.round((process.average?.observedSeconds ?? 0) / 60)} minutes observed in the selected window`
                      : undefined
                  }
                >
                  {visibleColumns.map((column) => (
                    <td key={column} data-label={processColumns[column].label}>
                      {column === 'name' ? (
                        <>
                          <strong>{process.name}</strong>
                          <small>
                            PID {process.pid}
                            {average
                              ? ` · ${Math.round((process.average?.observedSeconds ?? 0) / 60)} min observed`
                              : ''}
                          </small>
                        </>
                      ) : (
                        formatProcessValue(processValue(process, column, average), column)
                      )}
                    </td>
                  ))}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="activity-process-empty">
          {processes.length
            ? 'No processes match these filters.'
            : 'Waiting for the next macOS process sample…'}
        </p>
      )}
      <p className="process-sample-note">
        Per-process GPU and network usage are unavailable from public macOS APIs. Missing readings stay
        unavailable.
      </p>
    </section>
  );
}
