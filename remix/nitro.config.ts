import { defineNitroConfig } from 'nitro/config';

const publicDir = new URL('./dist', import.meta.url).pathname;
const designDocsDir = new URL('../docs/design', import.meta.url).pathname;
const apiHandler = './server/routes/api/[...].ts';
const apiRoutes = [
  'v1/auth/jwks',
  'v1/auth/logout',
  'v1/auth/me',
  'v1/auth/register',
  'v1/auth/resend-verification',
  'v1/auth/verify-email',
  'v1/crypto',
  'v1/login',
  'v1/lopu/musing',
  'v1/mongodb/get-connection',
  'v1/mongodb/populate',
  'v1/mongodb/raw-results',
  'v1/mongodb/status',
  'v1/mongodb/status-data',
  'v1/template',
  'v1/vercel/deployments',
  'v1/vercel/status',
  'v1/vercel/status-data'
];

export default defineNitroConfig({
  serverDir: 'server',
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
