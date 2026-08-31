import { useEffect, useState } from 'react';
import type { CommanderSettings, SearchCacheStatus, SearchCategory } from '@commander/protocol';
import {
  SEARCH_CACHE_MAX_BYTES,
  SEARCH_CACHE_MAX_TTL_MINUTES,
  SEARCH_CACHE_MIN_BYTES,
  SEARCH_CACHE_MIN_TTL_MINUTES,
} from '@commander/protocol';
import {
  AppWindow,
  Database,
  FileStack,
  FolderOpen,
  GripVertical,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { nativeRequest } from '../lib/nativeBridge.js';

const categoryCopy: Record<SearchCategory, { title: string; description: string; Icon: typeof AppWindow }> = {
  applications: {
    title: 'Apps',
    description: 'Applications receive the strongest default boost.',
    Icon: AppWindow,
  },
  commands: {
    title: 'Commands',
    description: 'Commander, extension, system, and quicklink commands.',
    Icon: TerminalSquare,
  },
  files: {
    title: 'Files & Folders',
    description: 'Local metadata results from the Rust filesystem index.',
    Icon: FileStack,
  },
};

export function SearchPreferencesSettings({
  settings,
  onChange,
  onError,
}: {
  settings: CommanderSettings;
  onChange(next: CommanderSettings): void;
  onError(value: string | null): void;
}) {
  const [dragging, setDragging] = useState<SearchCategory | null>(null);
  const [cacheStatus, setCacheStatus] = useState<SearchCacheStatus | null>(null);
  const [cacheDirectory, setCacheDirectory] = useState(settings.searchCache.directory ?? '');
  const [cacheSizeMiB, setCacheSizeMiB] = useState(
    String(Math.round(settings.searchCache.maxSizeBytes / 1_048_576)),
  );
  const [cacheTtlHours, setCacheTtlHours] = useState(formatHours(settings.searchCache.ttlMinutes));

  useEffect(() => setCacheDirectory(settings.searchCache.directory ?? ''), [settings.searchCache.directory]);
  useEffect(
    () => setCacheSizeMiB(String(Math.round(settings.searchCache.maxSizeBytes / 1_048_576))),
    [settings.searchCache.maxSizeBytes],
  );
  useEffect(
    () => setCacheTtlHours(formatHours(settings.searchCache.ttlMinutes)),
    [settings.searchCache.ttlMinutes],
  );

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await api.searchCacheStatus();
        if (!cancelled) setCacheStatus(next);
      } catch {
        // Cache settings remain editable when its status cannot be measured.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const reorder = (target: SearchCategory) => {
    if (!dragging || dragging === target) return;
    const order = [...settings.resultCategoryOrder];
    const sourceIndex = order.indexOf(dragging);
    const targetIndex = order.indexOf(target);
    if (sourceIndex < 0 || targetIndex < 0) return;
    order.splice(sourceIndex, 1);
    order.splice(targetIndex, 0, dragging);
    setDragging(null);
    onChange({ ...settings, resultCategoryOrder: order });
  };

  const commitDirectory = () => {
    const directory = cacheDirectory.trim() || null;
    setCacheDirectory(directory ?? '');
    if (directory !== settings.searchCache.directory)
      onChange({ ...settings, searchCache: { ...settings.searchCache, directory } });
  };

  const commitSize = () => {
    const parsed = Number(cacheSizeMiB);
    const bytes = Number.isFinite(parsed)
      ? Math.min(SEARCH_CACHE_MAX_BYTES, Math.max(SEARCH_CACHE_MIN_BYTES, Math.round(parsed * 1_048_576)))
      : settings.searchCache.maxSizeBytes;
    setCacheSizeMiB(String(Math.round(bytes / 1_048_576)));
    if (bytes !== settings.searchCache.maxSizeBytes)
      onChange({ ...settings, searchCache: { ...settings.searchCache, maxSizeBytes: bytes } });
  };

  const commitTtl = () => {
    const parsed = Number(cacheTtlHours);
    const minutes = Number.isFinite(parsed)
      ? Math.min(
          SEARCH_CACHE_MAX_TTL_MINUTES,
          Math.max(SEARCH_CACHE_MIN_TTL_MINUTES, Math.round(parsed * 60)),
        )
      : settings.searchCache.ttlMinutes;
    setCacheTtlHours(formatHours(minutes));
    if (minutes !== settings.searchCache.ttlMinutes)
      onChange({ ...settings, searchCache: { ...settings.searchCache, ttlMinutes: minutes } });
  };

  return (
    <section className="search-preferences-card" aria-label="Search presentation and cache">
      <div className="search-preference-section">
        <header>
          <div>
            <h3>Result Sections</h3>
            <p>
              Drag categories into your preferred order. Strong text and learned ranking can still move a
              better-matching section ahead.
            </p>
          </div>
        </header>
        <div className="search-category-order" role="list" aria-label="Search category priority">
          {settings.resultCategoryOrder.map((category, index) => {
            const { title, description, Icon } = categoryCopy[category];
            return (
              <button
                type="button"
                role="listitem"
                draggable
                className={dragging === category ? 'search-category-row dragging' : 'search-category-row'}
                key={category}
                onDragStart={() => setDragging(category)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => reorder(category)}
              >
                <GripVertical aria-hidden="true" />
                <Icon aria-hidden="true" />
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
                <kbd>{index + 1}</kbd>
              </button>
            );
          })}
        </div>
      </div>

      <div className="search-preference-section search-cache-settings">
        <header>
          <span className="search-preference-icon">
            <Database />
          </span>
          <div>
            <h3>Search Result Cache</h3>
            <p>Show the last-known matches immediately, then replace them as live index results stream in.</p>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.searchCache.enabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  searchCache: { ...settings.searchCache, enabled: event.currentTarget.checked },
                })
              }
            />
            <span className="toggle-box" aria-hidden="true">
              {settings.searchCache.enabled ? '✓' : ''}
            </span>
            <span>Enabled</span>
          </label>
        </header>
        <div className="search-cache-grid">
          <label>
            <span>Cache folder override</span>
            <input
              aria-label="Search cache folder override"
              value={cacheDirectory}
              placeholder="Use the Commander system cache folder"
              spellCheck={false}
              autoCorrect="off"
              onChange={(event) => setCacheDirectory(event.currentTarget.value)}
              onBlur={commitDirectory}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
          </label>
          <label>
            <span>Maximum cache size</span>
            <span className="search-cache-size-input">
              <input
                aria-label="Maximum search cache size in megabytes"
                type="number"
                min={SEARCH_CACHE_MIN_BYTES / 1_048_576}
                max={SEARCH_CACHE_MAX_BYTES / 1_048_576}
                value={cacheSizeMiB}
                onChange={(event) => setCacheSizeMiB(event.currentTarget.value)}
                onBlur={commitSize}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              />
              <small>MB</small>
            </span>
          </label>
          <label>
            <span>Refresh cached results after</span>
            <span className="search-cache-size-input">
              <input
                aria-label="Search cache lifetime in hours"
                type="number"
                min={SEARCH_CACHE_MIN_TTL_MINUTES / 60}
                max={SEARCH_CACHE_MAX_TTL_MINUTES / 60}
                step="0.5"
                value={cacheTtlHours}
                onChange={(event) => setCacheTtlHours(event.currentTarget.value)}
                onBlur={commitTtl}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              />
              <small>hours</small>
            </span>
          </label>
        </div>
        <div className="search-cache-status">
          <span>
            <strong>{cacheStatus ? formatBytes(cacheStatus.sizeBytes) : '—'}</strong>
            <small>{cacheStatus ? `${cacheStatus.entryCount} cached searches` : 'Measuring cache…'}</small>
          </span>
          <code>{cacheStatus?.effectiveDirectory ?? 'Commander cache folder'}</code>
          <button
            type="button"
            className="secondary-button compact"
            disabled={!cacheStatus}
            onClick={() =>
              void nativeRequest('filesystem.reveal', { path: cacheStatus?.effectiveDirectory }).catch(
                (error) =>
                  onError(error instanceof Error ? error.message : 'Could not reveal the cache folder'),
              )
            }
          >
            <FolderOpen /> Show
          </button>
          <button
            type="button"
            className="secondary-button compact danger"
            onClick={() =>
              void api
                .clearSearchCache()
                .then(({ status }) => {
                  setCacheStatus(status);
                  onError(null);
                })
                .catch((error: unknown) =>
                  onError(error instanceof Error ? error.message : 'Could not clear the search cache'),
                )
            }
          >
            <Trash2 /> Clear
          </button>
        </div>
      </div>
    </section>
  );
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${Math.max(0, Math.round(value))} B`;
  if (value < 1_048_576) return `${Math.max(0, Math.round(value / 1_024))} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${(value / 1_073_741_824).toFixed(1).replace(/\.0$/, '')} GB`;
}

function formatHours(minutes: number): string {
  return String(Math.round((minutes / 60) * 10) / 10);
}
