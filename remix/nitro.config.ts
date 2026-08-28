import { defineNitroConfig } from 'nitro/config';

import { apiV1DocsRouteKeys, apiV1RouteKeys } from './app/docs/apiDocs.ts';
import {
  CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH,
  CHATGPT_CAPABILITY_MANIFEST_PATH,
  CHATGPT_PROTECTED_RESOURCE_METADATA_PATH
} from './app/api/utils/chatgpt/pluginCore.ts';

const publicDir = new URL('./dist', import.meta.url).pathname;
const designDocsDir = new URL('../docs/design', import.meta.url).pathname;
const apiHandler = './server/routes/api/[...].ts';
const chatGptDiscoveryHandler = './server/routes/chatgpt-discovery.ts';
const apiRoutes = [...apiV1RouteKeys, ...apiV1DocsRouteKeys];

export default defineNitroConfig({
  serverDir: 'server',
  modules: ['workflow/nitro'],
  compatibilityDate: '2026-07-02',
  // The Vite shell copied by sync:nitro-template. Nitro's default assets:server
  // mount resolves to <rootDir>/assets (which does not exist here), so the page
  // catch-all reads the shell through this explicit assets:shell mount instead.
  serverAssets: [{ baseName: 'shell', dir: 'server/assets' }],
  routes: {
    ...Object.fromEntries(apiRoutes.map((route) => [`/api/${route}`, apiHandler])),
    [CHATGPT_PROTECTED_RESOURCE_METADATA_PATH]: chatGptDiscoveryHandler,
    [CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH]: chatGptDiscoveryHandler,
    [CHATGPT_CAPABILITY_MANIFEST_PATH]: chatGptDiscoveryHandler
  },
  publicAssets: [
    {
      baseURL: '/',
      dir: publicDir,
      maxAge: 60 * 60 * 24 * 365
    },
    {
      baseURL: '/docs/design-bundles',
      dir: designDocsDir,
      maxAge: 60 * 60
    }
  ]
});
