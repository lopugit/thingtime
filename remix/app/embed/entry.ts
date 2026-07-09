import { configFromScript, EMBED_VERSION, ThingtimeEmbedRuntime, type ThingtimeEmbedConfig } from './runtime';

type ThingtimeGlobal = {
	readonly version: string;
	readonly ready: Promise<ThingtimeEmbedRuntime>;
	configure(config?: ThingtimeEmbedConfig): ThingtimeGlobal;
	init(config?: ThingtimeEmbedConfig): ThingtimeGlobal;
	open(): ThingtimeGlobal;
	close(): ThingtimeGlobal;
	toggle(): ThingtimeGlobal;
	openSecureWindow(): Promise<void>;
	mount(target: string | Element, path?: string | Array<string | number>, options?: any): { id: string; unmount(): boolean };
	unmount(handle: string | { id: string }): boolean;
	get(path?: string | Array<string | number>): unknown;
	set(path: string | Array<string | number> | undefined, value: unknown): unknown;
	replace(value: unknown): unknown;
	subscribe(listener: (value: unknown, detail: { source: string }) => void): () => void;
	undo(): unknown;
	redo(): unknown;
	load(id?: string): Promise<unknown>;
	save(): Promise<unknown>;
	getDocument(): unknown;
	getStatus(): unknown;
	destroy(): void;
};

declare global {
	interface Window {
		Thingtime?: ThingtimeGlobal;
	}
}

const script = document.currentScript as HTMLScriptElement | null;
const mode = script?.dataset.thingtimeMode;
const nonce = script?.nonce || undefined;

const onDomReady = (callback: () => void) => {
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
	else callback();
};

if (mode === 'bridge') {
	onDomReady(() => {
		// Legacy Thingtime editor dependencies read process.env during module
		// initialization. The shim lives only in the first-party popup; the host
		// loader intentionally never creates or replaces window.process.
		const bridgeGlobal = globalThis as any;
		bridgeGlobal.process = bridgeGlobal.process || { env: {} };
		bridgeGlobal.process.env = bridgeGlobal.process.env || {};
		import('./bridge')
			.then(({ bootstrapBridge }) => bootstrapBridge())
			.catch((error) => {
				const message = document.createElement('pre');
				message.textContent = `Thingtime bridge could not start: ${error instanceof Error ? error.message : String(error)}`;
				document.body.replaceChildren(message);
			});
	});
} else if (!window.Thingtime) {
	const runtime = new ThingtimeEmbedRuntime(configFromScript(script), nonce);
	let api: ThingtimeGlobal;
	api = {
		version: EMBED_VERSION,
		ready: runtime.ready,
		configure(config) {
			runtime.configure(config);
			return api;
		},
		init(config) {
			runtime.configure(config);
			return api;
		},
		open() {
			runtime.open();
			return api;
		},
		close() {
			runtime.close();
			return api;
		},
		toggle() {
			runtime.toggle();
			return api;
		},
		openSecureWindow: () => runtime.openSecureWindow(),
		mount: (target, path, options) => runtime.mount(target, path, options),
		unmount: (handle) => runtime.unmount(handle),
		get: (path) => runtime.get(path),
		set: (path, value) => runtime.set(path, value),
		replace: (value) => runtime.replace(value),
		subscribe: (listener) => runtime.subscribe(listener as any),
		undo: () => runtime.undo(),
		redo: () => runtime.redo(),
		load: (id) => runtime.load(id),
		save: () => runtime.save(),
		getDocument: () => runtime.getDocument(),
		getStatus: () => runtime.getStatus(),
		destroy() {
			runtime.destroy();
			if (window.Thingtime === api) delete window.Thingtime;
		}
	};
	window.Thingtime = api;
}
