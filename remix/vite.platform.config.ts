import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export default defineConfig({
	publicDir: false,
	plugins: [
		{
			name: 'version-platform-runtime',
			generateBundle(_options, bundle) {
				const runtime = bundle['runtime.js'];
				if (!runtime || runtime.type !== 'chunk') throw new Error('Missing Web Platform runtime chunk');
				const digest = createHash('sha256').update(runtime.code).digest('hex');
				const template = readFileSync(fileURLToPath(new URL('./public/platform/runtime.html', import.meta.url)), 'utf8');
				if (!template.includes('src="/platform/runtime.js"')) throw new Error('Missing runtime script reference');
				// The no-store document changes the URL when code changes, including for
				// browsers that cached the former fixed URL before no-store shipped.
				this.emitFile({
					type: 'asset',
					fileName: 'runtime.html',
					source: template.replace('src="/platform/runtime.js"', `src="/platform/runtime.js?v=${digest}"`)
				});
			}
		}
	],
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
