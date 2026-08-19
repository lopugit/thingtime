import { useEffect, useMemo, useState } from 'react';
import type {
  CommanderSettings,
  IndexIgnoreRule,
  IndexScope,
  IndexingSettings as IndexingPreferences,
  IndexingStatus,
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
    const refresh = async () => {
      try {
        const next = await api.indexingStatus();
        if (!cancelled) setStatus(next);
      } catch (error) {
        if (!cancelled) onError(error instanceof Error ? error.message : 'Could not load index status');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
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
        Applications refresh every {status?.automaticRefresh.applicationsMinutes ?? 5} minutes; files and
        folders reconcile every {formatInterval(draft.refreshIntervalMinutes)} and whenever their settings
        change.
      </div>

      <div className="index-privacy-note">
        <ShieldCheck />
        <span>
          <strong>macOS whole-home access</strong>
          <small>
            Grant Commander Full Disk Access for a complete ~ index. Without it, use explicitly allowed
            folders as roots.
          </small>
        </span>
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

      <div className="index-settings-section">
        <div className="index-section-heading">
          <div>
            <strong>Filesystem roots</strong>
            <span>Use ~ for your home directory. Nested duplicate roots are de-duplicated by path.</span>
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
            <small>Off by default to keep the index focused and lightweight.</small>
          </span>
        </div>
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

function formatInterval(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
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
