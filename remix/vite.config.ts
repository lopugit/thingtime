import { vitePlugin as remix } from '@remix-run/dev';
import { installGlobals } from '@remix-run/node';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { flatRoutes } from 'remix-flat-routes';

// nativeFetch is required by Single Fetch (turbo-stream over undici)
installGlobals({ nativeFetch: true });

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
      routes: async (defineRoutes) => {
        return flatRoutes('routes', defineRoutes);
      },

      serverModuleFormat: 'cjs',

      // Single Fetch: loader/action data is fetched via `<route>.data`
      // instead of `?_data=<routeId>`
      future: {
        v3_singleFetch: true
      },

      // app path
      appDirectory: 'app'
    }),
    tsconfigPaths()
  ]
  // plugins: [remix(), tsconfigPaths()],
});
