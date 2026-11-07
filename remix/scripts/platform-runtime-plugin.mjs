import { platformRuntimeCsp } from './csp.mjs';
import { watchFile, unwatchFile } from 'node:fs';
import { platformRuntimeDocument, platformRuntimePath, readPlatformRuntime } from './platform-runtime.mjs';

const moduleId = 'virtual:thingtime-platform-document';
/** Include the actual compiled isolated renderer as data in an app chunk.
 * Opaque frames cannot fetch through the app's offline service worker. */
export function platformRuntimePlugin({ external = false } = {}) {
	let runtime;
	return {
		name: 'thingtime-platform-document',
		resolveId(id) {
			if (id === moduleId) return '\0' + moduleId;
		},
		load(id) {
			if (id !== '\0' + moduleId) return;
			if (external) return 'export default null;';
			runtime = readPlatformRuntime();
			return `export default ${JSON.stringify(platformRuntimeDocument(runtime, platformRuntimeCsp))};`;
		},
		generateBundle() {
			if (external) return;
			if (!runtime) throw new Error('Web Platform document was not included in the app');
			// Main Vite output clears dist. Retain the same external runtime for tools
			// that intentionally use the standalone URL and its HTTP CSP.
			for (const [fileName, source] of [
				['runtime.js', runtime.code],
				['runtime.html', runtime.html]
			])
				this.emitFile({ type: 'asset', fileName: `platform/${fileName}`, source });
		},
		configureServer(server) {
			if (external) return;
			// Vite ignores its output directory. The existing build:platform watcher
			// writes there; watch that one file so a rebuilt interpreter cannot leave
			// the virtual document serving an old compiled program vocabulary.
			const changed = () => {
				let next;
				try {
					next = readPlatformRuntime();
				} catch {
					return;
				}
				if (!runtime || next.hash === runtime.hash) return;
				runtime = next;
				const module = server.moduleGraph.getModuleById('\0' + moduleId);
				if (module) {
					server.moduleGraph.invalidateModule(module);
					server.ws.send({ type: 'full-reload' });
				}
			};
			watchFile(platformRuntimePath, { persistent: false, interval: 500 }, changed);
			server.httpServer?.once('close', () => unwatchFile(platformRuntimePath, changed));
		}
	};
}
