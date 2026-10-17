/** Visibility may pause a run unless its current native file job explicitly
 * obtained OS background authority. Tokens isolate concurrent/late callbacks. */
const active = new WeakMap<AbortSignal, Set<symbol>>();
export function nativeUploadMayContinue(signal: AbortSignal): boolean {
	return !signal.aborted && Boolean(active.get(signal)?.size);
}
export function trackNativeUploadBackground(signal: AbortSignal) {
	const token = Symbol();
	let disposed = false;
	const set = (allowed: boolean) => {
		if (disposed) return;
		if (allowed && !signal.aborted) {
			const tokens = active.get(signal) ?? new Set<symbol>();
			tokens.add(token);
			active.set(signal, tokens);
		} else {
			const tokens = active.get(signal);
			tokens?.delete(token);
			if (!tokens?.size) active.delete(signal);
		}
	};
	return {
		set,
		dispose() {
			set(false);
			disposed = true;
		}
	};
}
