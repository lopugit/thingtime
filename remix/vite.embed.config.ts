import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	publicDir: false,
	plugins: [react()],
	resolve: {
		alias: {
			'~': fileURLToPath(new URL('./app', import.meta.url))
		},
		tsconfigPaths: true
	},
	build: {
		outDir: 'dist/embed',
		// The normal client build copies bridge.html + demo.html first. Preserve
		// those while writing the one generated JavaScript artifact beside them.
		emptyOutDir: false,
		target: 'es2019',
		minify: 'oxc',
		sourcemap: false,
		cssCodeSplit: false,
		lib: {
			entry: fileURLToPath(new URL('./app/embed/entry.ts', import.meta.url)),
			name: 'ThingtimeBundle',
			formats: ['iife'],
			fileName: () => 'thingtime.min.js'
		},
		rolldownOptions: {
			output: {
				codeSplitting: false
			}
		}
	}
});
