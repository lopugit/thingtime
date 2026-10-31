import { useEffect, useState } from 'react';
import type { SystemMetrics } from '@commander/protocol';
import { nativeBridgeAvailable, nativeRequest } from '../lib/nativeBridge.js';

export function useSystemMetrics(onError: (message: string | null) => void, averageSeconds = 0) {
  const [metrics, setMetrics] = useState<SystemMetrics>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!nativeBridgeAvailable()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const next = await nativeRequest<SystemMetrics>('system.metrics', { averageSeconds });
        if (!cancelled && next) {
          setMetrics(next);
          onError(null);
        }
      } catch (error) {
        if (!cancelled) onError(error instanceof Error ? error.message : 'Could not read Commander activity');
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = window.setTimeout(() => void refresh(), 2000);
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onError, averageSeconds]);
  return { metrics, loading };
}
