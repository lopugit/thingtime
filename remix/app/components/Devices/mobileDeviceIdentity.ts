import { nativeBridgeReadyEvent } from '../../utils/nativeBridge';

type IdentityEnvironment = {
	window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
	document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
	current(): boolean;
	subscribe(refresh: () => void): () => void;
	supported(): boolean;
	verify(signal: AbortSignal): Promise<unknown>;
	withdraw(): void;
};

/** Account authority is essential lifecycle work, independent of optional polling.
 * Verification is read-only: the native host may resume an existing scoped opt-in,
 * but this observer never enables collection, requests permission or pairs a device. */
export function startMobileDeviceIdentity(environment: IdentityEnvironment) {
	let disposed = false;
	let verified = false;
	let withdrawn = false;
	let pending: AbortController | undefined;
	const cancel = () => { pending?.abort(); pending = undefined; };
	const withdraw = () => {
		cancel();
		verified = false;
		if (!withdrawn) environment.withdraw();
		withdrawn = true;
	};
	const refresh = () => {
		if (disposed) return;
		if (!environment.current()) { withdraw(); return; }
		withdrawn = false;
		if (environment.document.visibilityState !== 'visible' || !environment.supported() || verified || pending) return;
		const controller = new AbortController();
		pending = controller;
		void environment.verify(controller.signal).then(
			() => {
				if (disposed || pending !== controller || controller.signal.aborted) return;
				if (!environment.current()) withdraw();
				else verified = true;
			},
			() => { /* Retry only after an identity/readiness/foreground/network event. */ }
		).finally(() => { if (pending === controller) pending = undefined; });
	};
	const foreground = () => { verified = false; refresh(); };
	const visibility = () => {
		if (environment.document.visibilityState !== 'visible') { cancel(); verified = false; }
		else foreground();
	};
	const unsubscribe = environment.subscribe(refresh);
	const events = ['focus', 'pageshow', 'online', nativeBridgeReadyEvent];
	for (const name of events) environment.window.addEventListener(name, foreground);
	environment.document.addEventListener('visibilitychange', visibility);
	// StrictMode's discarded mount must not start a native verification.
	queueMicrotask(refresh);
	return {
		refresh,
		stop() {
			if (disposed) return;
			disposed = true;
			unsubscribe();
			withdraw();
			for (const name of events) environment.window.removeEventListener(name, foreground);
			environment.document.removeEventListener('visibilitychange', visibility);
		}
	};
}
