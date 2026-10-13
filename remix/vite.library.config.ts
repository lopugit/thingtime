import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
	publicDir: false,
	build: {
		outDir: 'dist/library',
		emptyOutDir: false,
		sourcemap: false,
		lib: {
			entry: fileURLToPath(new URL('./app/library/sandboxEntry.ts', import.meta.url)),
			name: 'ThingtimeLibrary',
			formats: ['iife'],
			fileName: () => 'runner.js'
		}
	}
});
