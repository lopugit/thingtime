/** Editor.js uses realm globals and has no document/window option. Foreign
 * Builder documents load only this fixed library entry, never another app. */
import { importEditorJsRuntime, EDITOR_RUNTIME_SLOT, type EditorJsRuntime } from './editorJsRuntimeImports';
type RuntimeView = Window & { [EDITOR_RUNTIME_SLOT]?: () => Promise<EditorJsRuntime> };
export function cacheEditorRuntimes(load: (owner: Document) => Promise<EditorJsRuntime>) {
	const runtimes = new WeakMap<Document, Promise<EditorJsRuntime>>();
	return (owner: Document) => {
		const prior = runtimes.get(owner);
		if (prior) return prior;
		const pending = load(owner);
		runtimes.set(owner, pending);
		void pending.catch(() => {
			if (runtimes.get(owner) === pending) runtimes.delete(owner);
		});
		return pending;
	};
}
/** Entry is a build-owned URL, never a saved/authored script source. */
export function loadEditorRuntimeScript(owner: Document, entry: string, timeoutMs = 20000): Promise<EditorJsRuntime> {
	return new Promise((resolve, reject) => {
		const view = owner.defaultView as RuntimeView | null;
		if (!view || !owner.head || !owner.documentElement?.isConnected) {
			reject(new Error('The editor document closed before its module opened.'));
			return;
		}
		const script = owner.createElement('script');
		script.type = 'module';
		script.src = entry;
		let settled = false;
		const finish = (error?: Error, runtime?: EditorJsRuntime) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			script.onload = null;
			script.onerror = null;
			script.remove();
			if (error) reject(error);
			else resolve(runtime!);
		};
		const accept = async () => {
			try {
				const factory = view[EDITOR_RUNTIME_SLOT];
				if (typeof factory !== 'function') throw new Error('The editor module did not initialize in this document.');
				const runtime = await factory();
				if (!owner.documentElement?.isConnected || owner.defaultView !== view)
					throw new Error('The editor document changed while its module opened.');
				if (!(runtime.EditorJS instanceof (view as any).Function)) throw new Error('The editor module opened in a different document realm.');
				finish(undefined, runtime);
			} catch (error) {
				finish(error instanceof Error ? error : new Error('The editor module could not open.'));
			}
		};
		const timer = setTimeout(() => finish(new Error('The editor module did not open in this document. Try opening the field again.')), timeoutMs);
		if (typeof view[EDITOR_RUNTIME_SLOT] === 'function') {
			void accept();
			return;
		}
		script.onload = () => void accept();
		script.onerror = () => finish(new Error('The editor module could not load. Try opening the field again.'));
		owner.head.append(script);
	});
}
export const loadEditorJsRuntime = cacheEditorRuntimes(async (owner) => {
	if (typeof document === 'undefined' || typeof window === 'undefined')
		throw new Error('The editor runtime is available only in its browser document.');
	if (owner === document) return importEditorJsRuntime();
	// Vite bundles this fixed entry; it runs as a normal module, never a Worker.
	const entries = import.meta.glob('./editorJsRuntime.entry.ts', { query: '?worker&url', import: 'default' });
	const entry = await entries['./editorJsRuntime.entry.ts']();
	if (typeof entry !== 'string') throw new Error('The editor module URL is unavailable.');
	return loadEditorRuntimeScript(owner, new URL(entry, window.location.href).href);
});
