import { defineNitroConfig } from 'nitro/config';

import { apiV1DocsRouteKeys, apiV1RouteKeys } from './app/docs/apiDocs.ts';

const publicDir = new URL('./dist', import.meta.url).pathname;
const designDocsDir = new URL('../docs/design', import.meta.url).pathname;
const apiHandler = './server/routes/api/[...].ts';
const apiRoutes = [...apiV1RouteKeys, ...apiV1DocsRouteKeys];

export default defineNitroConfig({
  serverDir: 'server',
  modules: ['workflow/nitro'],
  compatibilityDate: '2026-07-02',
  routes: Object.fromEntries(apiRoutes.map((route) => [`/api/${route}`, apiHandler])),
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
