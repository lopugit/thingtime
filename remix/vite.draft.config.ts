import { platformRuntimePlugin } from './scripts/platform-runtime-plugin.mjs';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { draftPreviewCsp } from './scripts/csp.mjs';
export default defineConfig({
  publicDir: false,
  resolve: { alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [platformRuntimePlugin({ external: true }), { name: 'draft-html', closeBundle() {
    mkdirSync('dist/draft-preview', { recursive: true });
    writeFileSync('dist/draft-preview/policy.json', JSON.stringify({ contentSecurityPolicy: draftPreviewCsp }));
    copyFileSync('public/draft-preview/index.html', 'dist/draft-preview/index.html');
  } }],
  build: { outDir: 'dist/draft-preview', emptyOutDir: false, sourcemap: false,
    lib: { entry: fileURLToPath(new URL('./app/draftPreview/entry.tsx', import.meta.url)), name: 'ThingtimeDraft', formats: ['iife'], fileName: () => 'runner.js' },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
});
