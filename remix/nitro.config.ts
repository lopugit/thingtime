import { defineNitroConfig } from 'nitro/config';

import { apiV1DocsRouteKeys, apiV1RouteKeys } from './app/docs/apiDocs.ts';
import {
  CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH,
  CHATGPT_CAPABILITY_MANIFEST_PATH,
  CHATGPT_PROTECTED_RESOURCE_METADATA_PATH
} from './app/api/utils/chatgpt/pluginCore.ts';
import { THINGTIME_CAPABILITY_MANIFEST_PATH } from './app/api/utils/capabilities/thingtimeCapabilities.ts';

const publicDir = new URL('./dist', import.meta.url).pathname;
const embedDir = new URL('./dist/embed', import.meta.url).pathname;
const designDocsDir = new URL('../docs/design', import.meta.url).pathname;
const apiHandler = './server/routes/api/[...].ts';
const chatGptDiscoveryHandler = './server/routes/chatgpt-discovery.ts';
const thingtimeCapabilitiesHandler = './server/handlers/thingtime-capabilities.ts';
const apiRoutes = [...apiV1RouteKeys, ...apiV1DocsRouteKeys];

export default defineNitroConfig({
  serverDir: 'server',
  modules: ['workflow/nitro'],
  compatibilityDate: '2026-07-02',
  routes: {
    ...Object.fromEntries(apiRoutes.map((route) => [`/api/${route}`, apiHandler])),
    [THINGTIME_CAPABILITY_MANIFEST_PATH]: thingtimeCapabilitiesHandler,
    [CHATGPT_PROTECTED_RESOURCE_METADATA_PATH]: chatGptDiscoveryHandler,
    [CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH]: chatGptDiscoveryHandler,
    [CHATGPT_CAPABILITY_MANIFEST_PATH]: chatGptDiscoveryHandler
  },
  publicAssets: [
    {
      baseURL: '/embed',
      dir: embedDir,
      // The SDK uses a stable copy-paste URL; revalidate it frequently so an
      // old browser cache cannot pin an incompatible protocol for a year.
      maxAge: 60 * 5
    },
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
