import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CommanderSettings,
  IndexIgnoreRule,
  IndexScope,
  IndexingSettings as IndexingPreferences,
  IndexingStatus,
} from '@commander/protocol';
import {
  INDEXING_MAX_CPU_PERCENT,
  INDEXING_MAX_ENTRIES_LIMIT,
  INDEXING_MAX_MEMORY_MIB,
  INDEXING_MAX_OPEN_DIRECTORIES_LIMIT,
  INDEXING_MAX_PARALLELISM_LIMIT,
  INDEXING_MAX_THREADS_LIMIT,
  INDEXING_MIN_CPU_PERCENT,
  INDEXING_MIN_MEMORY_MIB,
} from '@commander/protocol';
import {
  AppWindow,
  Database,
  File,
  Folder,
  Plus,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { nativeRequest } from '../lib/nativeBridge.js';

export function IndexingSettings({
  settings,
  onChange,
  onError,
}: {
  settings: CommanderSettings;
  onChange(next: CommanderSettings): void;
  onError(value: string | null): void;
}) {
  const [draft, setDraft] = useState<IndexingPreferences>(() => structuredClone(settings.indexing));
  const [status, setStatus] = useState<IndexingStatus | null>(null);
  const [requesting, setRequesting] = useState<IndexScope | null>(null);

  useEffect(() => setDraft(structuredClone(settings.indexing)), [settings.indexing]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const next = await api.indexingStatus();
        if (!cancelled) setStatus(next);
      } catch (error) {
        if (!cancelled) onError(error instanceof Error ? error.message : 'Could not load index status');
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void refresh(), 5_000);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [onError]);

  const commit = (next: IndexingPreferences) => {
    setDraft(next);
    onChange({ ...settings, indexing: next });
  };

  const indexNow = async (scope: IndexScope) => {
    setRequesting(scope);
    try {
      const response = await api.indexNow(scope);
      setStatus(response.status);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : `Could not index ${scope}`);
    } finally {
      setRequesting(null);
    }
  };

  const cards = useMemo(() => statusCards(status), [status]);
  const running = new Set(status?.running ?? []);
  const messages = [
    ...(status?.message ? [status.message] : []),
    ...new Set(status?.kinds.flatMap((kind) => (kind.lastError ? [kind.lastError] : [])) ?? []),
  ];

  return (
    <section className="indexing-card" aria-labelledby="indexing-settings-title">
      <div className="indexing-heading">
        <span className="indexing-heading-icon">
          <Database />
        </span>
        <div>
          <h3 id="indexing-settings-title">Search Index</h3>
          <p>Local metadata only—Commander never reads or stores file contents.</p>
        </div>
        <Toggle
          checked={draft.enabled}
          onChange={(enabled) => commit({ ...draft, enabled })}
          label="Index files and folders"
        />
      </div>

      <div className="index-status-grid">
        {cards.map(({ id, title, Icon, count, indexed }) => (
          <div className="index-status-card" key={id}>
            <Icon />
            <span>
              <strong>{title}</strong>
              <small>{formatCount(count)}</small>
            </span>
            <time>{indexed}</time>
          </div>
        ))}
      </div>

      <div className="index-actions" aria-label="Manual index controls">
        <IndexButton
          label="Index All"
          scope="all"
          active={requesting === 'all' || running.has('all')}
          onClick={indexNow}
        />
        <IndexButton
          label="Apps"
          scope="applications"
          active={requesting === 'applications' || running.has('applications')}
          onClick={indexNow}
        />
        <IndexButton
          label="Commands"
          scope="commands"
          active={requesting === 'commands' || running.has('commands')}
          onClick={indexNow}
        />
        <IndexButton
          label="Files"
          scope="files"
          active={requesting === 'files' || running.has('files')}
          disabled={!draft.enabled}
          onClick={indexNow}
        />
        <IndexButton
          label="Folders"
          scope="directories"
          active={requesting === 'directories' || running.has('directories')}
          disabled={!draft.enabled}
          onClick={indexNow}
        />
      </div>

      <div className="index-refresh-copy">
        <span>
          App bundle changes are watched live; every mounted volume is also reconciled every{' '}
          {formatInterval(status?.automaticRefresh.applicationsMinutes ?? 360)}. Files and folders reconcile
          every {formatInterval(draft.refreshIntervalMinutes)} and whenever their settings change.
        </span>
        <strong aria-label="Search index database size">
          Database {status ? formatBytes(status.databaseSizeBytes) : '—'}
        </strong>
      </div>

      <div className="index-settings-section">
        <div className="index-section-heading">
          <div>
            <strong>Filesystem roots</strong>
            <span>
              / indexes this Mac and every currently mounted volume. Use ~ for only your home directory;
              nested duplicate roots are de-duplicated by path.
            </span>
          </div>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => commit({ ...draft, roots: [...draft.roots, '~/Documents'] })}
          >
            <Plus /> Add Root
          </button>
        </div>
        <div className="index-rule-list">
          {draft.roots.map((root, index) => (
            <div className="index-root-row" key={`root:${index}`}>
              <Folder />
              <input
                aria-label={`Filesystem root ${index + 1}`}
                value={root}
                spellCheck={false}
                autoCorrect="off"
                onChange={(event) => {
                  const roots = [...draft.roots];
                  roots[index] = event.target.value;
                  setDraft({ ...draft, roots });
                }}
                onBlur={() => commit(draft)}
                onKeyDown={(event) => event.key === 'Enter' && commit(draft)}
              />
              <button
                type="button"
                className="icon-button danger"
                aria-label={`Remove filesystem root ${root}`}
                disabled={draft.roots.length === 1}
                onClick={() => commit({ ...draft, roots: draft.roots.filter((_, item) => item !== index) })}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="index-options">
        <div>
          <Toggle
            checked={draft.respectGitIgnore}
            onChange={(respectGitIgnore) => commit({ ...draft, respectGitIgnore })}
            label="Inherit .gitignore files"
          />
          <span>
            <strong>Inherit .gitignore files</strong>
            <small>Includes parent rules, .git/info/exclude, and your global Git excludes.</small>
          </span>
        </div>
        <div>
          <Toggle
            checked={draft.includeHidden}
            onChange={(includeHidden) => commit({ ...draft, includeHidden })}
            label="Include hidden files"
          />
          <span>
            <strong>Include hidden files</strong>
            <small>On by default so dotfiles and hidden folders remain searchable.</small>
          </span>
        </div>
      </div>

      <div className="index-settings-section">
        <div className="index-section-heading">
          <div>
            <strong>Index reliability</strong>
            <span>
              Set a custom timeout only when a healthy scan needs more time than Commander’s automatic limit.
            </span>
          </div>
        </div>
        <div className="index-resource-grid single">
          <TimeoutInput
            value={draft.customTimeoutMs}
            onCommit={(customTimeoutMs) => commit({ ...draft, customTimeoutMs })}
          />
        </div>
        {status?.timing.samples ? (
          <div className="index-resource-summary" aria-label="Recent index timing">
            This Commander session: {formatDuration(status.timing.averageDurationMs ?? 0)} average across{' '}
            {status.timing.samples} successful {status.timing.samples === 1 ? 'run' : 'runs'}; last{' '}
            {formatDuration(status.timing.lastDurationMs ?? 0)}, longest{' '}
            {formatDuration(status.timing.longestDurationMs ?? 0)}.
          </div>
        ) : (
          <div className="index-resource-summary">
            Timing will appear after the next successful index run.
          </div>
        )}
        {status?.timeoutAttempts.length ? (
          <div className="index-timeout-history" aria-label="Timed out index attempts">
            <strong>Timed out attempts this session</strong>
            {status.timeoutAttempts.map((attempt) => (
              <div key={attempt.id} className="index-status-message">
                <span>{attempt.message}</span>
                <time>{formatIndexedAt(attempt.occurredAtMs)}</time>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="index-settings-section">
        <div className="index-section-heading">
          <div>
            <strong>Index capacity</strong>
            <span>Leave the entry limit blank to index every matching item.</span>
          </div>
        </div>
        <div className="index-resource-grid single">
          <OptionalEntryLimitInput
            value={draft.maxEntries}
            onCommit={(maxEntries) => commit({ ...draft, maxEntries })}
          />
        </div>
      </div>

      <div className="index-settings-section">
        <div className="index-section-heading">
          <div>
            <strong>Machine resources</strong>
            <span>
              Limits apply inside the standalone Rust indexer. The strictest thread, parallel-task, and
              open-folder ceiling wins.
            </span>
          </div>
        </div>
        <div className="index-resource-grid">
          <ResourceLimitInput
            label="Scanner threads"
            description="Maximum Rust traversal workers."
            value={draft.resourceLimits.maxThreads}
            minimum={1}
            maximum={INDEXING_MAX_THREADS_LIMIT}
            onCommit={(maxThreads) =>
              commit({ ...draft, resourceLimits: { ...draft.resourceLimits, maxThreads } })
            }
          />
          <ResourceLimitInput
            label="Parallel tasks"
            description="Maximum directory work in flight."
            value={draft.resourceLimits.maxParallelism}
            minimum={1}
            maximum={INDEXING_MAX_PARALLELISM_LIMIT}
            onCommit={(maxParallelism) =>
              commit({ ...draft, resourceLimits: { ...draft.resourceLimits, maxParallelism } })
            }
          />
          <ResourceLimitInput
            label="Open folders"
            description="Maximum directory handles at once."
            value={draft.resourceLimits.maxOpenDirectories}
            minimum={1}
            maximum={INDEXING_MAX_OPEN_DIRECTORIES_LIMIT}
            onCommit={(maxOpenDirectories) =>
              commit({ ...draft, resourceLimits: { ...draft.resourceLimits, maxOpenDirectories } })
            }
          />
          <ResourceLimitInput
            label="Max CPU"
            description="Share of total machine CPU capacity."
            value={draft.resourceLimits.maxCpuPercent}
            minimum={INDEXING_MIN_CPU_PERCENT}
            maximum={INDEXING_MAX_CPU_PERCENT}
            suffix="%"
            onCommit={(maxCpuPercent) =>
              commit({ ...draft, resourceLimits: { ...draft.resourceLimits, maxCpuPercent } })
            }
          />
          <ResourceLimitInput
            label="Max memory"
            description="Hard resident-memory ceiling."
            value={draft.resourceLimits.maxMemoryMiB}
            minimum={INDEXING_MIN_MEMORY_MIB}
            maximum={INDEXING_MAX_MEMORY_MIB}
            suffix="MB"
            onCommit={(maxMemoryMiB) =>
              commit({ ...draft, resourceLimits: { ...draft.resourceLimits, maxMemoryMiB } })
            }
          />
        </div>
        {status?.lastRunResources ? (
          <div className="index-resource-summary" aria-label="Last index resource usage">
            Last run used {status.lastRunResources.effective.workerThreads} worker
            {status.lastRunResources.effective.workerThreads === 1 ? '' : 's'}, averaged{' '}
            {status.lastRunResources.averageCpuPercent}% CPU, peaked at{' '}
            {formatBytes(status.lastRunResources.peakMemoryBytes)}, and was throttled for{' '}
            {formatDuration(status.lastRunResources.throttledMs)}.
          </div>
        ) : null}
      </div>

      <div className="index-settings-section">
        <div className="index-section-heading">
          <div>
            <strong>Custom ignore list</strong>
            <span>Wildcards match paths or names; regular expressions match normalized / paths.</span>
          </div>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() =>
              commit({
                ...draft,
                customIgnores: [...draft.customIgnores, { kind: 'glob', pattern: '**/build/**' }],
              })
            }
          >
            <Plus /> Add Ignore
          </button>
        </div>
        <div className="index-rule-list">
          {draft.customIgnores.map((rule, index) => (
            <IgnoreRuleRow
              key={`ignore:${index}`}
              index={index}
              rule={rule}
              onDraft={(next) => {
                const customIgnores = [...draft.customIgnores];
                customIgnores[index] = next;
                setDraft({ ...draft, customIgnores });
              }}
              onCommit={() => commit(draft)}
              onRemove={() =>
                commit({
                  ...draft,
                  customIgnores: draft.customIgnores.filter((_, item) => item !== index),
                })
              }
            />
          ))}
        </div>
      </div>

      {messages.map((message) => (
        <div className="index-status-message" key={message}>
          {message}
        </div>
      ))}
    </section>
  );
}

/**
 * Kept at the very top of Search settings instead of inside the lengthy index
 * configuration form. Permission state is important enough to be visible
 * without scrolling, even before the first index has completed.
 */
export function FullDiskAccessCard({ onError }: { onError(value: string | null): void }) {
  const [fullDiskAccess, setFullDiskAccess] = useState<
    'checking' | 'granted' | 'not-granted' | 'unavailable'
  >('checking');

  const refreshFullDiskAccess = useCallback(async () => {
    setFullDiskAccess('checking');
    try {
      const result = await nativeRequest<{ granted?: unknown }>('permission.fullDiskAccess');
      setFullDiskAccess(
        result === undefined ? 'unavailable' : result.granted === true ? 'granted' : 'not-granted',
      );
    } catch (error) {
      setFullDiskAccess('unavailable');
      onError(error instanceof Error ? error.message : 'Could not check Full Disk Access');
    }
  }, [onError]);

  useEffect(() => {
    void refreshFullDiskAccess();
  }, [refreshFullDiskAccess]);

  return (
    <section className="full-disk-access-card" aria-labelledby="full-disk-access-title">
      <ShieldCheck aria-hidden="true" />
      <div>
        <div className="full-disk-access-title-row">
          <strong id="full-disk-access-title">macOS whole-volume access</strong>
          <span className={`full-disk-access-status is-${fullDiskAccess}`} aria-live="polite">
            {fullDiskAccessLabel(fullDiskAccess)}
          </span>
        </div>
        <small>
          {fullDiskAccess === 'granted'
            ? 'Commander can scan protected locations. The check only opens macOS’s protected TCC database and never reads its contents.'
            : 'Grant Commander Full Disk Access for a complete whole-volume index. Without it, use explicitly allowed folders as roots.'}
        </small>
      </div>
      <div className="full-disk-access-actions">
        <button
          type="button"
          className="secondary-button compact"
          disabled={fullDiskAccess === 'checking'}
          onClick={() => void refreshFullDiskAccess()}
        >
          {fullDiskAccess === 'checking' ? 'Checking…' : 'Recheck'}
        </button>
        <button
          type="button"
          className="secondary-button compact"
          onClick={() =>
            void nativeRequest('application.open', {
              path: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
            }).catch((error) =>
              onError(error instanceof Error ? error.message : 'Could not open System Settings'),
            )
          }
        >
          Open Full Disk Access
        </button>
      </div>
    </section>
  );
}

function ResourceLimitInput({
  label,
  description,
  value,
  minimum,
  maximum,
  suffix,
  onCommit,
}: {
  label: string;
  description: string;
  value: number;
  minimum: number;
  maximum: number;
  suffix?: string;
  onCommit(value: number): void;
}) {
  const [draftValue, setDraftValue] = useState(String(value));
  useEffect(() => setDraftValue(String(value)), [value]);
  const commitValue = () => {
    const parsed = draftValue.trim() ? Number(draftValue) : Number.NaN;
    const next = Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : value;
    setDraftValue(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <label className="index-resource-field">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="index-resource-input">
        <input
          aria-label={label}
          type="number"
          min={minimum}
          max={maximum}
          step={1}
          value={draftValue}
          spellCheck={false}
          onChange={(event) => setDraftValue(event.currentTarget.value)}
          onBlur={commitValue}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
        {suffix ? <small>{suffix}</small> : null}
      </span>
    </label>
  );
}

function OptionalEntryLimitInput({
  value,
  onCommit,
}: {
  value: number | null;
  onCommit(value: number | null): void;
}) {
  const [draftValue, setDraftValue] = useState(value === null ? '' : String(value));
  useEffect(() => setDraftValue(value === null ? '' : String(value)), [value]);
  const commitValue = () => {
    const normalized = draftValue.trim();
    if (!normalized) {
      setDraftValue('');
      if (value !== null) onCommit(null);
      return;
    }
    const parsed = Number(normalized);
    const next = Number.isSafeInteger(parsed)
      ? Math.min(INDEXING_MAX_ENTRIES_LIMIT, Math.max(1, parsed))
      : value;
    setDraftValue(next === null ? '' : String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <label className="index-resource-field">
      <span>
        <strong>Maximum entries</strong>
        <small>Blank means unlimited. Set a whole number to constrain disk use.</small>
      </span>
      <span className="index-resource-input wide">
        <input
          aria-label="Maximum index entries"
          type="number"
          min={1}
          max={INDEXING_MAX_ENTRIES_LIMIT}
          step={1}
          value={draftValue}
          placeholder="Unlimited"
          spellCheck={false}
          onChange={(event) => setDraftValue(event.currentTarget.value)}
          onBlur={commitValue}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
      </span>
    </label>
  );
}

function TimeoutInput({ value, onCommit }: { value: number | null; onCommit(value: number | null): void }) {
  const [draftValue, setDraftValue] = useState(value === null ? '' : String(value));
  useEffect(() => setDraftValue(value === null ? '' : String(value)), [value]);
  const commitValue = () => {
    const normalized = draftValue.trim();
    if (!normalized) {
      setDraftValue('');
      if (value !== null) onCommit(null);
      return;
    }
    const parsed = Number(normalized);
    const next = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : value;
    setDraftValue(next === null ? '' : String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <label className="index-resource-field">
      <span>
        <strong>Custom index timeout</strong>
        <small>
          Milliseconds. Blank uses Commander’s automatic timeout; enter digits only, with no configured cap.
        </small>
      </span>
      <span className="index-resource-input wide">
        <input
          aria-label="Custom index timeout in milliseconds"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draftValue}
          placeholder="Automatic"
          spellCheck={false}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (/^\d*$/.test(next)) setDraftValue(next);
          }}
          onBlur={commitValue}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
        <small>ms</small>
      </span>
    </label>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${Math.max(0, Math.round(value))} B`;
  if (value < 1024 * 1024) return `${Math.max(0, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${formatUnit(value / 1024 / 1024)} MB`;
  return `${formatUnit(value / 1024 / 1024 / 1024)} GB`;
}

function formatUnit(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.max(0, Math.round(value))} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function formatInterval(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function fullDiskAccessLabel(status: 'checking' | 'granted' | 'not-granted' | 'unavailable'): string {
  if (status === 'granted') return 'Full Disk Access granted';
  if (status === 'not-granted') return 'Full Disk Access not granted';
  if (status === 'unavailable') return 'Full Disk Access status unavailable';
  return 'Checking Full Disk Access…';
}

function IgnoreRuleRow({
  index,
  rule,
  onDraft,
  onCommit,
  onRemove,
}: {
  index: number;
  rule: IndexIgnoreRule;
  onDraft(value: IndexIgnoreRule): void;
  onCommit(): void;
  onRemove(): void;
}) {
  return (
    <div className="index-ignore-row">
      <select
        aria-label={`Ignore rule ${index + 1} type`}
        value={rule.kind}
        onChange={(event) => onDraft({ ...rule, kind: event.target.value as IndexIgnoreRule['kind'] })}
        onBlur={onCommit}
      >
        <option value="glob">Wildcard</option>
        <option value="regex">Regex</option>
      </select>
      <input
        aria-label={`Ignore rule ${index + 1} pattern`}
        value={rule.pattern}
        spellCheck={false}
        autoCorrect="off"
        onChange={(event) => onDraft({ ...rule, pattern: event.target.value })}
        onBlur={onCommit}
        onKeyDown={(event) => event.key === 'Enter' && onCommit()}
      />
      <button type="button" className="icon-button danger" aria-label="Remove ignore rule" onClick={onRemove}>
        <Trash2 />
      </button>
    </div>
  );
}

function IndexButton({
  label,
  scope,
  active,
  disabled = false,
  onClick,
}: {
  label: string;
  scope: IndexScope;
  active: boolean;
  disabled?: boolean;
  onClick(scope: IndexScope): Promise<void>;
}) {
  return (
    <button
      type="button"
      className="secondary-button compact"
      disabled={disabled || active}
      onClick={() => void onClick(scope)}
    >
      <RefreshCw className={active ? 'spinning' : ''} />
      {active ? 'Indexing…' : label}
    </button>
  );
}

function statusCards(status: IndexingStatus | null) {
  const byKind = new Map(status?.kinds.map((kind) => [kind.kind, kind]) ?? []);
  return [
    {
      id: 'applications',
      title: 'Applications',
      Icon: AppWindow,
      count: byKind.get('application')?.count ?? 0,
      indexed: formatIndexedAt(byKind.get('application')?.lastIndexedAtMs),
    },
    {
      id: 'commands',
      title: 'Commands',
      Icon: TerminalSquare,
      count: status?.commands.count ?? 0,
      indexed: formatIndexedAt(status?.commands.lastIndexedAtMs),
    },
    {
      id: 'files',
      title: 'Files',
      Icon: File,
      count: byKind.get('file')?.count ?? 0,
      indexed: formatIndexedAt(byKind.get('file')?.lastIndexedAtMs),
    },
    {
      id: 'directories',
      title: 'Folders',
      Icon: Folder,
      count: byKind.get('directory')?.count ?? 0,
      indexed: formatIndexedAt(byKind.get('directory')?.lastIndexedAtMs),
    },
  ];
}

function formatCount(value: number): string {
  return `${new Intl.NumberFormat().format(value)} indexed`;
}

function formatIndexedAt(value?: number): string {
  if (!value) return 'Not indexed yet';
  const difference = Date.now() - value;
  if (difference < 60_000) return 'Just now';
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString();
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="toggle-row">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-box" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
    </label>
  );
}
