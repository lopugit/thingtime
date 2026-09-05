// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, type ThingtimeNetworkProbe } from '@commander/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { ActivitySettings } from './ActivitySettings.js';

vi.mock('../lib/api.js', () => ({ api: { activityNetwork: vi.fn(), activityNetworkSpeed: vi.fn() } }));
vi.mock('../lib/nativeBridge.js', () => ({ nativeBridgeAvailable: () => true, nativeRequest: vi.fn() }));

const ping: ThingtimeNetworkProbe = {
  sampledAtMs: 1,
  ping: { roundTripMs: 68, requestMs: 67, responseMs: 1 },
};
const speed: ThingtimeNetworkProbe = {
  ...ping,
  speed: {
    sampledAtMs: 1,
    packetBytes: [1, 2],
    downloads: [
      { bytes: 1_000_000, durationMs: 1000, megabitsPerSecond: 8 },
      { bytes: 8_000_000, durationMs: 4000, megabitsPerSecond: 16 },
    ],
    uploads: [{ bytes: 1_000_000, durationMs: 1000, megabitsPerSecond: 8 }],
    errors: [{ direction: 'upload', message: 'Speed-test cooldown; retry in 2 minute(s) (429)' }],
  },
};
const renderActivity = () =>
  render(<ActivitySettings settings={DEFAULT_SETTINGS} onChange={vi.fn()} onError={vi.fn()} />);

describe('Activity network measurements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.activityNetwork).mockResolvedValue(ping);
    vi.mocked(api.activityNetworkSpeed).mockResolvedValue(speed);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('preserves partial results and their error across the latency refresh; weights speed by bytes and duration', async () => {
    renderActivity();
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Run 17.6/ }));
    });
    expect(screen.getByText('14.4 Mbps')).toBeVisible();
    expect(screen.getByText('8.0 Mbps')).toBeVisible();
    expect(screen.getByText(/2\/2 download and 1\/2 upload/)).toHaveTextContent('Partial results shown.');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(api.activityNetwork).toHaveBeenCalledTimes(2);
    expect(screen.getByText('14.4 Mbps')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Upload: Speed-test cooldown');
  });

  it('keeps the last measurements and a speed-test error when a later run fails completely', async () => {
    renderActivity();
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Run 17.6/ }));
    });
    vi.mocked(api.activityNetworkSpeed).mockRejectedValue(new Error('Connection interrupted'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Run 17.6/ }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText('14.4 Mbps')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Connection interrupted');
  });

  it('disables duplicate clicks and suppresses latency traffic during a speed test', async () => {
    let finish!: (value: ThingtimeNetworkProbe) => void;
    vi.mocked(api.activityNetworkSpeed).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderActivity();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /Run 17.6/ }));
    const measuring = screen.getByRole('button', { name: /Measuring/ });
    expect(measuring).toBeDisabled();
    fireEvent.click(measuring);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(api.activityNetworkSpeed).toHaveBeenCalledTimes(1);
    expect(api.activityNetwork).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(speed);
    });
    expect(screen.getByRole('button', { name: /Run 17.6/ })).toBeEnabled();
  });
});
