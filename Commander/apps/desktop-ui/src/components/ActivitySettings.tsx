import { useEffect, useState } from 'react';
import type { SystemMetrics } from '@commander/protocol';
import { Activity, Cpu, HardDrive, MemoryStick, MonitorCog, RefreshCw } from 'lucide-react';
import { nativeBridgeAvailable, nativeRequest } from '../lib/nativeBridge.js';

const REFRESH_INTERVAL_MS = 2_000;

export function ActivitySettings({ onError }: { onError(value: string | null): void }) {
  const [metrics, setMetrics] = useState<SystemMetrics>();
  const [loading, setLoading] = useState(true);

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
            value={`${formatBytes(machine?.memoryUsedBytes)} / ${formatBytes(machine?.memoryTotalBytes)}`}
            detail="Active, wired, cached, and compressed memory"
            percent={ratio(machine?.memoryUsedBytes, machine?.memoryTotalBytes)}
          />
          <MetricCard
            Icon={HardDrive}
            title="Filesystem"
            value={`${formatBytes(machine?.filesystemAvailableBytes)} free`}
            detail={`${formatBytes(machine?.filesystemUsedBytes)} used of ${formatBytes(machine?.filesystemTotalBytes)}`}
            percent={ratio(machine?.filesystemUsedBytes, machine?.filesystemTotalBytes)}
          />
        </div>
      </section>
      <p className="activity-footnote">
        GPU utilisation is a best-effort system-wide value exposed by the active macOS graphics driver;
        Commander does not attribute GPU work to individual apps.
      </p>
    </div>
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
  muted?: boolean;
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

function formatBytes(value: number | undefined): string {
  if (value === undefined || value <= 0) return '—';
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

function ratio(value: number | undefined, total: number | undefined): number | undefined {
  if (!value || !total) return undefined;
  return (value / total) * 100;
}
