import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
	publicDir: false,
	build: {
		outDir: 'dist/platform',
		emptyOutDir: false,
		sourcemap: false,
		lib: {
			entry: fileURLToPath(new URL('./app/webPlatform/runtimeEntry.ts', import.meta.url)),
			name: 'ThingtimeWebPlatform',
			formats: ['iife'],
			fileName: () => 'runtime.js'
		}
	}
});
