import { vitePlugin as remix } from '@remix-run/dev';
import { installGlobals } from '@remix-run/node';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { flatRoutes } from 'remix-flat-routes';

// nativeFetch is required by Single Fetch (turbo-stream over undici)
installGlobals({ nativeFetch: true });

// Only the real production deploy gets a minified bundle. Preview (PR) builds
// and local builds stay un-minified + sourcemapped so they're debuggable in the
// browser console. VERCEL_ENV is 'production' | 'preview' | 'development'.
const isVercelProduction = process.env.VERCEL_ENV === 'production';

// Deploy env baked into the bundle so the client can tell dev/preview from
// production (Vercel sets VERCEL_ENV at build time; it isn't otherwise visible
// in the browser). Used to auto-show the DevKit on dev + preview.
const deployEnv = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';

export default defineConfig({
	define: {
		__TT_DEPLOY_ENV__: JSON.stringify(deployEnv)
	},
	build: {
		minify: isVercelProduction,
		sourcemap: !isVercelProduction
	},

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
	// plugins: [remix(), tsconfigPaths()]
});
