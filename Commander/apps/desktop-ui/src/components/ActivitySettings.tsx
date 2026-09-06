import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommanderSettings,
  SystemMetrics,
  SystemProcessMetric,
  SystemResponsivenessApplication,
  ThingtimeNetworkProbe,
} from '@commander/protocol';
import {
  Activity,
  AlertTriangle,
  Cpu,
  HardDrive,
  MemoryStick,
  MonitorCog,
  Network,
  Play,
  RefreshCw,
  RotateCcw,
  Rows3,
  Power,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { nativeBridgeAvailable, nativeRequest } from '../lib/nativeBridge.js';
import '../styles/ActivityUnresponsiveApplications.css';

const REFRESH_INTERVAL_MS = 2_000;
const NETWORK_PING_INTERVAL_MS = 15_000;
type ProcessSortKey = 'name' | 'parent' | 'cpu' | 'gpu' | 'memory' | 'network' | 'disk';
type SortDirection = 'ascending' | 'descending';
type ApplicationControlAction = 'quit' | 'forceQuit' | 'restart';
type ApplicationControlResult = { submitted?: boolean; cancelled?: boolean };

export function ActivitySettings({
  settings,
  onChange,
  onError,
}: {
  settings: CommanderSettings;
  onChange(next: CommanderSettings): void;
  onError(value: string | null): void;
}) {
  const [metrics, setMetrics] = useState<SystemMetrics>();
  const [network, setNetwork] = useState<ThingtimeNetworkProbe>();
  const [networkError, setNetworkError] = useState<string>();
  const [speedError, setSpeedError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [speedTesting, setSpeedTesting] = useState(false);
  const [sortKey, setSortKey] = useState<ProcessSortKey>('cpu');
  const [sortDirection, setSortDirection] = useState<SortDirection>('descending');
  const [groupByParent, setGroupByParent] = useState(false);
  const speedTestInFlight = useRef(false);
  const networkGeneration = useRef(0);

  useEffect(() => {
    if (!nativeBridgeAvailable()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await nativeRequest<SystemMetrics>('system.metrics');
        if (!cancelled && next) {
          setMetrics(next);
          setLoading(false);
          onError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLoading(false);
          onError(error instanceof Error ? error.message : 'Could not read Commander activity');
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onError]);

  useEffect(() => {
    let cancelled = false;
    networkGeneration.current += 1;
    setNetwork(undefined);
    setNetworkError(undefined);
    setSpeedError(undefined);
    const refresh = async () => {
      if (speedTestInFlight.current) return;
      try {
        const next = await api.activityNetwork();
        if (!cancelled) {
          setNetwork((previous) => ({ ...next, ...(previous?.speed ? { speed: previous.speed } : {}) }));
          setNetworkError(undefined);
        }
      } catch (error) {
        if (!cancelled)
          setNetworkError(error instanceof Error ? error.message : 'Thingtime latency check failed');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), NETWORK_PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      networkGeneration.current += 1;
      window.clearInterval(timer);
    };
  }, [settings.thingtimeBaseUrl, settings.activeAccountId]);

  const runSpeedTest = useCallback(async () => {
    if (speedTestInFlight.current) return;
    speedTestInFlight.current = true;
    const generation = networkGeneration.current;
    setSpeedTesting(true);
    try {
      const next = await api.activityNetworkSpeed();
      if (generation !== networkGeneration.current) return;
      const hasSamples = Boolean(next.speed?.downloads.length || next.speed?.uploads.length);
      setNetwork((previous) => (hasSamples || !previous?.speed ? next : { ...next, speed: previous.speed }));
      setNetworkError(undefined);
      setSpeedError(
        !hasSamples && next.speed?.errors?.length
          ? next.speed.errors.map((error) => error.message).join(' ')
          : undefined,
      );
    } catch (error) {
      if (generation === networkGeneration.current)
        setSpeedError(error instanceof Error ? error.message : 'Thingtime speed test failed');
    } finally {
      speedTestInFlight.current = false;
      setSpeedTesting(false);
    }
  }, []);

  useEffect(() => {
    if (!settings.activity.periodicSpeedTestEnabled) return;
    const timer = window.setInterval(
      () => void runSpeedTest(),
      settings.activity.periodicSpeedTestIntervalMinutes * 60_000,
    );
    return () => window.clearInterval(timer);
  }, [
    runSpeedTest,
    settings.activity.periodicSpeedTestEnabled,
    settings.activity.periodicSpeedTestIntervalMinutes,
  ]);

  const setActivitySettings = (patch: Partial<CommanderSettings['activity']>) => {
    onChange({ ...settings, activity: { ...settings.activity, ...patch } });
  };

  const controlUnresponsiveApplication = async (pid: number, action: ApplicationControlAction) => {
    try {
      const result = await nativeRequest<ApplicationControlResult>('application.control', { pid, action });
      if (!result?.submitted && !result?.cancelled) {
        throw new Error('Commander could not submit that application control request.');
      }
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Commander could not control that application.');
      throw error;
    }
  };

  if (!nativeBridgeAvailable()) {
    return (
      <div className="settings-page activity-settings activity-unavailable">
        <MonitorCog />
        <h2>Activity</h2>
        <p>Live machine metrics are available from the native Commander desktop app.</p>
      </div>
    );
  }

  const machine = metrics?.machine;
  const commander = metrics?.commander;
  const memory = machine?.memory;
  const filesystem = machine?.filesystem;
  return (
    <div className="settings-page activity-settings">
      <div className="activity-heading">
        <span className="activity-heading-icon">
          <Activity />
        </span>
        <div>
          <h2>Activity</h2>
          <p>Live, local-only resource usage for Commander and this Mac.</p>
        </div>
        <span className="activity-refresh">
          <RefreshCw className={loading ? 'spinning' : ''} /> Every 2 seconds
        </span>
      </div>

      <section className="activity-section" aria-labelledby="commander-usage-title">
        <div className="activity-section-heading">
          <div>
            <h3 id="commander-usage-title">Commander usage</h3>
            <p>Includes the native host and its local daemon.</p>
          </div>
          <span>{commander?.processCount ?? 0} processes</span>
        </div>
        <div className="activity-grid">
          <MetricCard
            Icon={Cpu}
            title="CPU"
            value={formatPercent(commander?.cpuPercent)}
            detail="Across Commander processes"
            percent={commander?.cpuPercent}
          />
          <MetricCard
            Icon={MemoryStick}
            title="Memory"
            value={formatBytes(commander?.residentMemoryBytes)}
            detail={`${formatBytes(commander?.virtualMemoryBytes)} virtual`}
          />
          <MetricCard
            Icon={HardDrive}
            title="Storage"
            value={formatBytes(commander?.storageBytes)}
            detail="App, state, cache, and local index"
          />
        </div>
      </section>

      <section className="activity-section" aria-labelledby="machine-usage-title">
        <div className="activity-section-heading">
          <div>
            <h3 id="machine-usage-title">Machine usage</h3>
            <p>Read directly from macOS. Nothing here leaves this device.</p>
          </div>
          <span className={`thermal-state thermal-${machine?.thermalState ?? 'nominal'}`}>
            Thermal {machine?.thermalState ?? '—'}
          </span>
        </div>
        <div className="activity-grid machine-grid">
          <MetricCard
            Icon={Cpu}
            title="System CPU"
            value={formatPercent(machine?.cpuPercent)}
            detail={`${machine?.logicalCpuCount ?? '—'} logical cores`}
            percent={machine?.cpuPercent}
          />
          <MetricCard
            Icon={MonitorCog}
            title="GPU"
            value={
              machine?.gpu.utilizationPercent === undefined
                ? 'Unavailable'
                : formatPercent(machine.gpu.utilizationPercent)
            }
            detail={machine?.gpu.name ?? 'Detecting GPU'}
            percent={machine?.gpu.utilizationPercent}
            muted={machine?.gpu.utilizationPercent === undefined}
          />
          <MetricCard
            Icon={MemoryStick}
            title="System memory"
            value={`${formatBytes(memory?.usedBytes ?? machine?.memoryUsedBytes)} / ${formatBytes(memory?.totalBytes ?? machine?.memoryTotalBytes)}`}
            detail="Active, wired, cached, and compressed below"
            percent={ratio(
              memory?.usedBytes ?? machine?.memoryUsedBytes,
              memory?.totalBytes ?? machine?.memoryTotalBytes,
            )}
          />
          <MetricCard
            Icon={HardDrive}
            title="Filesystem"
            value={`${formatBytes(filesystem?.availableBytes ?? machine?.filesystemAvailableBytes)} free`}
            detail={`${formatBytes(filesystem?.usedBytes ?? machine?.filesystemUsedBytes)} used · ${formatBytes(filesystem?.purgeableBytes)} purgeable`}
            percent={ratio(
              filesystem?.usedBytes ?? machine?.filesystemUsedBytes,
              filesystem?.totalBytes ?? machine?.filesystemTotalBytes,
            )}
          />
        </div>
        <div className="activity-breakdown-grid" aria-label="Memory and filesystem breakdown">
          <Breakdown label="Active memory" value={formatBytes(memory?.activeBytes)} />
          <Breakdown label="Wired memory" value={formatBytes(memory?.wiredBytes)} />
          <Breakdown label="Cached memory" value={formatBytes(memory?.cachedBytes)} />
          <Breakdown label="Compressed memory" value={formatBytes(memory?.compressedBytes)} />
          <Breakdown label="Purgeable memory" value={formatBytes(memory?.purgeableBytes)} />
          <Breakdown label="Purgeable filesystem" value={formatBytes(filesystem?.purgeableBytes)} />
        </div>
      </section>

      <NetworkCard
        network={network}
        error={
          [
            networkError,
            speedError,
            ...(network?.speed?.errors ?? []).map(
              ({ direction, message }) => `${direction === 'download' ? 'Download' : 'Upload'}: ${message}`,
            ),
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
        speedTesting={speedTesting}
        periodicEnabled={settings.activity.periodicSpeedTestEnabled}
        periodicIntervalMinutes={settings.activity.periodicSpeedTestIntervalMinutes}
        onPeriodicChange={(periodicSpeedTestEnabled) => setActivitySettings({ periodicSpeedTestEnabled })}
        onIntervalChange={(periodicSpeedTestIntervalMinutes) =>
          setActivitySettings({ periodicSpeedTestIntervalMinutes })
        }
        onRunSpeedTest={() => void runSpeedTest()}
      />
      <UnresponsiveApplications
        applications={machine?.responsivenessApplications ?? []}
        onControl={controlUnresponsiveApplication}
      />
      <ProcessTable
        processes={machine?.processes ?? []}
        sortKey={sortKey}
        sortDirection={sortDirection}
        groupByParent={groupByParent}
        onSort={(next) => {
          if (next === sortKey)
            setSortDirection((direction) => (direction === 'ascending' ? 'descending' : 'ascending'));
          else {
            setSortKey(next);
            setSortDirection(next === 'name' || next === 'parent' ? 'ascending' : 'descending');
          }
        }}
        onGroupChange={setGroupByParent}
      />
      <p className="activity-footnote">
        GPU utilisation is a best-effort system-wide value exposed by the active macOS graphics driver. macOS
        does not expose stable public per-process GPU or network counters, so those process columns remain
        unavailable rather than being guessed. Filesystem purgeable capacity is macOS’s reclaimable-space
        estimate, not a promise that every byte can be reclaimed immediately.
      </p>
    </div>
  );
}

function UnresponsiveApplications({
  applications,
  onControl,
}: {
  applications: SystemResponsivenessApplication[];
  onControl(pid: number, action: ApplicationControlAction): Promise<void>;
}) {
  const [pendingPID, setPendingPID] = useState<number>();

  if (!applications.length) return null;

  const control = async (pid: number, action: ApplicationControlAction) => {
    setPendingPID(pid);
    try {
      await onControl(pid, action);
    } catch {
      // The parent reports the native error through the settings error surface.
    } finally {
      setPendingPID(undefined);
    }
  };

  const confirmedCount = applications.filter(
    (application) => application.signal === 'repeatedAccessibilityTimeout',
  ).length;
  const inconclusiveCount = applications.length - confirmedCount;
  const hasConfirmedTimeout = confirmedCount > 0;

  return (
    <section
      className={`activity-section activity-unresponsive-applications${hasConfirmedTimeout ? ' has-confirmed-timeout' : ''}`}
      aria-labelledby="responsiveness-applications-title"
    >
      <div className="activity-section-heading">
        <div>
          <h3 id="responsiveness-applications-title">
            {hasConfirmedTimeout ? <AlertTriangle /> : <Activity />} Responsiveness signals
          </h3>
          <p>
            UI apps require two timed-out accessibility probes before Commander calls them unresponsive.
            Agents and services stay visible, but macOS has no generic public health probe for them.
          </p>
        </div>
        <span>
          {hasConfirmedTimeout ? `${confirmedCount} confirmed` : `${inconclusiveCount} informational`}
        </span>
      </div>
      <p className="activity-unresponsive-note">
        Controls are available for every listed process so you can manage it deliberately. An accessibility
        result from an agent or service is diagnostic context, not evidence that the process is frozen.
      </p>
      <div className="activity-unresponsive-list">
        {applications.map((application) => {
          const pending = pendingPID === application.pid;
          const confirmed = application.signal === 'repeatedAccessibilityTimeout';
          return (
            <div
              className={`activity-unresponsive-row${confirmed ? ' confirmed' : ' informational'}`}
              key={application.pid}
            >
              <div className="activity-unresponsive-app-name">
                {confirmed ? <AlertTriangle aria-hidden="true" /> : <Activity aria-hidden="true" />}
                <div>
                  <strong>{application.name}</strong>
                  <div
                    className="activity-unresponsive-badges"
                    aria-label={`Process classification for ${application.name}`}
                  >
                    <span className="activity-unresponsive-badge kind">
                      {application.kind === 'ui'
                        ? 'UI app'
                        : application.kind === 'agent'
                          ? 'Agent'
                          : 'Service'}
                    </span>
                    <span className={`activity-unresponsive-badge signal${confirmed ? ' confirmed' : ''}`}>
                      {confirmed ? '2 AX timeouts' : 'AX probe inconclusive'}
                    </span>
                  </div>
                  <small>
                    PID {application.pid} ·{' '}
                    {confirmed
                      ? 'Repeated UI accessibility timeouts; this is actionable, but can still be transient.'
                      : 'Process is alive; its type has no generic macOS responsiveness test.'}
                  </small>
                </div>
              </div>
              <div className="activity-unresponsive-actions">
                <button
                  type="button"
                  className="activity-unresponsive-action"
                  disabled={pending}
                  onClick={() => void control(application.pid, 'quit')}
                >
                  <Power /> {pending ? 'Working…' : 'Quit'}
                </button>
                <button
                  type="button"
                  className="activity-unresponsive-action force-quit"
                  disabled={pending}
                  onClick={() => void control(application.pid, 'forceQuit')}
                >
                  <AlertTriangle /> Force quit
                </button>
                <button
                  type="button"
                  className="activity-unresponsive-action"
                  disabled={pending}
                  onClick={() => void control(application.pid, 'restart')}
                >
                  <RotateCcw /> Quit & restart
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MetricCard({
  Icon,
  title,
  value,
  detail,
  percent,
  muted = false,
}: {
  Icon: typeof Cpu;
  title: string;
  value: string;
  detail: string;
  percent?: number | undefined;
  muted?: boolean | undefined;
}) {
  const bounded = percent === undefined ? undefined : Math.max(0, Math.min(100, percent));
  return (
    <div className={`activity-metric${muted ? ' muted' : ''}`}>
      <Icon />
      <span className="activity-metric-title">{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      {bounded === undefined ? null : (
        <span className="activity-meter">
          <i style={{ width: `${bounded}%` }} />
        </span>
      )}
    </div>
  );
}

function Breakdown({ label, value }: { label: string; value: string }) {
  return (
    <div className="activity-breakdown">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NetworkCard({
  network,
  error,
  speedTesting,
  periodicEnabled,
  periodicIntervalMinutes,
  onPeriodicChange,
  onIntervalChange,
  onRunSpeedTest,
}: {
  network?: ThingtimeNetworkProbe | undefined;
  error?: string | undefined;
  speedTesting: boolean;
  periodicEnabled: boolean;
  periodicIntervalMinutes: number;
  onPeriodicChange(value: boolean): void;
  onIntervalChange(value: number): void;
  onRunSpeedTest(): void;
}) {
  const downloads = averageSpeed(network?.speed?.downloads);
  const uploads = averageSpeed(network?.speed?.uploads);
  return (
    <section className="activity-section activity-network-card" aria-labelledby="network-usage-title">
      <div className="activity-section-heading">
        <div>
          <h3 id="network-usage-title">
            <Network /> Thingtime network
          </h3>
          <p>Direct, uncached latency to your Thingtime server. Speed tests are explicit and bounded.</p>
        </div>
        <span>
          {network
            ? `Updated ${new Date(network.sampledAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
            : 'Checking…'}
        </span>
      </div>
      <div className="network-stat-grid">
        <Breakdown label="Round trip" value={formatDuration(network?.ping.roundTripMs)} />
        <Breakdown label="Request / send" value={formatDuration(network?.ping.requestMs)} />
        <Breakdown label="Response / receive" value={formatDuration(network?.ping.responseMs)} />
        <Breakdown
          label="Download"
          value={downloads === undefined ? 'Run test' : `${downloads.toFixed(1)} Mbps`}
        />
        <Breakdown label="Upload" value={uploads === undefined ? 'Run test' : `${uploads.toFixed(1)} Mbps`} />
      </div>
      {error ? (
        <p className="activity-network-error" role="status">
          {error}
        </p>
      ) : null}
      <div className="activity-network-controls">
        <button type="button" className="button-primary" disabled={speedTesting} onClick={onRunSpeedTest}>
          <Play /> {speedTesting ? 'Measuring…' : 'Run 17.6 MiB each-way test'}
        </button>
        <label className="activity-network-toggle">
          <input
            type="checkbox"
            checked={periodicEnabled}
            onChange={(event) => onPeriodicChange(event.target.checked)}
          />{' '}
          Run periodically
        </label>
        <label className="activity-network-interval">
          Every{' '}
          <select
            disabled={!periodicEnabled}
            value={periodicIntervalMinutes}
            onChange={(event) => onIntervalChange(Number(event.target.value))}
          >
            {[15, 30, 60, 120, 360, 720, 1440].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <small className="activity-network-note">
        Each complete test transfers 17.6 MiB down and 17.6 MiB up across 56 KiB, 500 KiB, 2 MiB, 5 MiB, and
        10 MiB samples. Uploads use serial chunks of at most 2 MiB. Automatic testing is off by default.
      </small>
      {network?.speed ? (
        <p className="activity-network-note">
          Speed test: {network.speed.downloads.length}/{network.speed.packetBytes.length} download and{' '}
          {network.speed.uploads.length}/{network.speed.packetBytes.length} upload samples completed
          {network.speed.sampledAtMs ? ` at ${new Date(network.speed.sampledAtMs).toLocaleTimeString()}` : ''}
          .{network.speed.errors?.length ? ' Partial results shown.' : ''}
        </p>
      ) : null}
    </section>
  );
}

function ProcessTable({
  processes,
  sortKey,
  sortDirection,
  groupByParent,
  onSort,
  onGroupChange,
}: {
  processes: SystemProcessMetric[];
  sortKey: ProcessSortKey;
  sortDirection: SortDirection;
  groupByParent: boolean;
  onSort(key: ProcessSortKey): void;
  onGroupChange(value: boolean): void;
}) {
  const sorted = useMemo(
    () => sortProcesses(processes, sortKey, sortDirection),
    [processes, sortKey, sortDirection],
  );
  const groups = useMemo(() => groupProcesses(sorted), [sorted]);
  return (
    <section className="activity-section activity-processes" aria-labelledby="process-usage-title">
      <div className="activity-section-heading">
        <div>
          <h3 id="process-usage-title">
            <Rows3 /> Processes
          </h3>
          <p>Live per-process CPU, memory, and disk throughput from macOS.</p>
        </div>
        <label className="activity-group-toggle">
          <input
            type="checkbox"
            checked={groupByParent}
            onChange={(event) => onGroupChange(event.target.checked)}
          />{' '}
          Group by parent
        </label>
      </div>
      <div className="activity-process-table-wrap">
        <table className="activity-process-table">
          <thead>
            <tr>
              <ProcessHeader
                label="Name"
                column="name"
                active={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
              <ProcessHeader
                label="Parent"
                column="parent"
                active={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
              <ProcessHeader
                label="CPU"
                column="cpu"
                active={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
              <ProcessHeader
                label="GPU"
                column="gpu"
                active={sortKey}
                direction={sortDirection}
                onSort={onSort}
                unavailable
              />
              <ProcessHeader
                label="Memory"
                column="memory"
                active={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
              <ProcessHeader
                label="Network"
                column="network"
                active={sortKey}
                direction={sortDirection}
                onSort={onSort}
                unavailable
              />
              <ProcessHeader
                label="Disk"
                column="disk"
                active={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
            </tr>
          </thead>
          <tbody>
            {groupByParent
              ? groups.map((group) => <ProcessGroupRows key={group.parentPid} group={group} />)
              : sorted.map((process) => <ProcessRow key={process.pid} process={process} />)}
          </tbody>
        </table>
      </div>
      {!processes.length ? (
        <p className="activity-process-empty">Waiting for the next macOS process sample…</p>
      ) : null}
    </section>
  );
}

function ProcessHeader({
  label,
  column,
  active,
  direction,
  onSort,
  unavailable = false,
}: {
  label: string;
  column: ProcessSortKey;
  active: ProcessSortKey;
  direction: SortDirection;
  onSort(key: ProcessSortKey): void;
  unavailable?: boolean;
}) {
  return (
    <th>
      <button
        type="button"
        title={unavailable ? `${label} is not exposed per process by public macOS APIs` : `Sort by ${label}`}
        onClick={() => onSort(column)}
      >
        {label}
        {unavailable ? ' —' : null}
        {active === column ? (direction === 'ascending' ? ' ↑' : ' ↓') : null}
      </button>
    </th>
  );
}
function ProcessGroupRows({ group }: { group: ProcessGroup }) {
  return (
    <>
      <tr className="activity-process-group">
        <td colSpan={7}>
          {group.parentName
            ? `${group.parentName} (${group.parentPid})`
            : `Parent process ${group.parentPid}`}{' '}
          <span>{group.processes.length} children</span>
        </td>
      </tr>
      {group.processes.map((process) => (
        <ProcessRow key={process.pid} process={process} />
      ))}
    </>
  );
}
function ProcessRow({ process }: { process: SystemProcessMetric }) {
  const disk = process.diskReadBytesPerSecond + process.diskWriteBytesPerSecond;
  return (
    <tr>
      <td>
        <strong>{process.name}</strong>
        <small>PID {process.pid}</small>
      </td>
      <td>{process.parentPid}</td>
      <td>{formatPercent(process.cpuPercent)}</td>
      <td>{formatOptionalPercent(process.gpuPercent)}</td>
      <td>{formatBytes(process.residentMemoryBytes)}</td>
      <td>{formatRate(process.networkBytesPerSecond)}</td>
      <td>{formatRate(disk)}</td>
    </tr>
  );
}
type ProcessGroup = {
  parentPid: number;
  parentName?: string | undefined;
  processes: SystemProcessMetric[];
};
function groupProcesses(processes: SystemProcessMetric[]): ProcessGroup[] {
  const names = new Map(processes.map((process) => [process.pid, process.name]));
  const groups = new Map<number, SystemProcessMetric[]>();
  for (const process of processes)
    groups.set(process.parentPid, [...(groups.get(process.parentPid) ?? []), process]);
  return [...groups.entries()].map(([parentPid, children]) => ({
    parentPid,
    parentName: names.get(parentPid),
    processes: children,
  }));
}
function sortProcesses(
  processes: SystemProcessMetric[],
  key: ProcessSortKey,
  direction: SortDirection,
): SystemProcessMetric[] {
  const factor = direction === 'ascending' ? 1 : -1;
  return [...processes].sort((left, right) => {
    if (key === 'name') return factor * left.name.localeCompare(right.name);
    const leftValue = processSortValue(left, key);
    const rightValue = processSortValue(right, key);
    if (leftValue === undefined && rightValue === undefined) return left.name.localeCompare(right.name);
    if (leftValue === undefined) return 1;
    if (rightValue === undefined) return -1;
    return factor * (leftValue - rightValue) || left.name.localeCompare(right.name);
  });
}
function processSortValue(
  process: SystemProcessMetric,
  key: Exclude<ProcessSortKey, 'name'>,
): number | undefined {
  if (key === 'parent') return process.parentPid;
  if (key === 'cpu') return process.cpuPercent;
  if (key === 'gpu') return process.gpuPercent;
  if (key === 'memory') return process.residentMemoryBytes;
  if (key === 'network') return process.networkBytesPerSecond;
  return process.diskReadBytesPerSecond + process.diskWriteBytesPerSecond;
}
function averageSpeed(values: Array<{ bytes: number; durationMs: number }> | undefined): number | undefined {
  if (!values?.length) return undefined;
  const bytes = values.reduce((total, value) => total + value.bytes, 0);
  const durationMs = values.reduce((total, value) => total + value.durationMs, 0);
  return durationMs > 0 ? (bytes * 8) / (durationMs * 1000) : undefined;
}
function formatBytes(value: number | undefined): string {
  if (value === undefined || value < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let next = value;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next >= 100 || index === 0 ? Math.round(next) : next.toFixed(1)} ${units[index]}`;
}
function formatPercent(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}
function formatOptionalPercent(value: number | undefined): string {
  return value === undefined ? '—' : formatPercent(value);
}
function formatRate(value: number | undefined): string {
  return value === undefined ? '—' : `${formatBytes(value)}/s`;
}
function formatDuration(value: number | undefined): string {
  return value === undefined ? '—' : `${Math.round(value)} ms`;
}
function ratio(value: number | undefined, total: number | undefined): number | undefined {
  if (value === undefined || !total) return undefined;
  return (value / total) * 100;
}
