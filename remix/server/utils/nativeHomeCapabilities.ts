import { hasNativeHomeSelection } from '../../app/api/utils/documentStore/nativeHomeSelection';
import type { NativeCapabilitySnapshot } from '../../app/api/utils/capabilities/runtimeAvailability';

/** Hosted discovery never loads native persistence. A selected but malformed,
 * closed or wrong-origin profile cannot advertise account operations. */
export async function nativeHomeCapabilitySnapshot(origin: string): Promise<NativeCapabilitySnapshot | undefined> {
 if (!hasNativeHomeSelection()) return undefined;
 const unavailable: NativeCapabilitySnapshot = { provider: 'sqlite', ready: false, supportedOperations: [] };
 try {
  const { getNativeHomeRuntime } = await import('./nativeHomeRuntime');
  const runtime = await getNativeHomeRuntime();
  return runtime?.origin === origin ? runtime.snapshot() : unavailable;
 } catch { return unavailable; }
}
