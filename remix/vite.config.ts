import { vitePlugin as remix } from '@remix-run/dev';
import { installGlobals } from '@remix-run/node';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

installGlobals();

// set app path to src/

export default defineConfig({
  // define web socket port

  server: {
    port: 9999,
    hmr: {
      port: 9998
    }
  },
  plugins: [
    remix({
      // app path
      appDirectory: 'src'
    }),
    tsconfigPaths()
  ]
  // plugins: [remix(), tsconfigPaths()],
});
