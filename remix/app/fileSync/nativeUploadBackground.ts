/** Visibility may pause a run unless its current native file job explicitly
 * obtained OS background authority. Tokens isolate concurrent/late callbacks. */
const active = new WeakMap<AbortSignal, Set<symbol>>();
const listeners = new WeakMap<AbortSignal, Set<() => void>>();
export function subscribeNativeUploadBackground(signal: AbortSignal, listener: () => void) {
	const group = listeners.get(signal) ?? new Set<() => void>();
	group.add(listener); listeners.set(signal, group);
	return () => { group.delete(listener); if (!group.size) listeners.delete(signal); };
}
export function nativeUploadMayContinue(signal: AbortSignal): boolean {
	return !signal.aborted && Boolean(active.get(signal)?.size);
}
export function trackNativeUploadBackground(signal: AbortSignal) {
	const token = Symbol();
	let disposed = false;
	const set = (allowed: boolean) => {
		if (disposed) return;
		const before = nativeUploadMayContinue(signal);
		if (allowed && !signal.aborted) {
			const tokens = active.get(signal) ?? new Set<symbol>();
			tokens.add(token);
			active.set(signal, tokens);
		} else {
			const tokens = active.get(signal);
			tokens?.delete(token);
			if (!tokens?.size) active.delete(signal);
		}
		if (before !== nativeUploadMayContinue(signal)) for (const listener of listeners.get(signal) ?? []) listener();
	};
	return {
		set,
		dispose() {
			set(false);
			disposed = true;
		}
	};
}
