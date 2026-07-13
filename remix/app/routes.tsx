import {
  createBrowserRouter,
  redirect,
  type LoaderFunctionArgs
} from 'react-router';

import App from './root';
import type { RootLoaderData } from './root-data.server';
import Branding from './routes/branding/_index';
import BrandingOld from './routes/branding_old';
import CryptoPage from './routes/crypto';
import DocsLayout from './routes/docs/DocsLayout';
import DocsApi from './routes/docs/api';
import DocsConcepts from './routes/docs/concepts/index';
import DocsDesign from './routes/docs/design';
import DocsDesignSystem from './routes/docs/design-system/index';
import DocsIndex from './routes/docs/index';
import Edge from './routes/edge';
import Feed from './routes/feed';
import Index from './routes/_index';
import Login from './routes/login';
import SettingsRoute from './routes/settings';
import MongoStatusPage from './routes/mongodb-status';
import Ode from './routes/ode';
import Profile from './routes/profile';
import Rainbow from './routes/rainbow.$';
import Raw from './routes/raw';
import Register from './routes/register';
import ResetPassword from './routes/reset-password';
import SchemasRoute from './routes/schemas';
import DocsSchemas from './routes/docs/schemas';
import SearchRoute from './routes/search';
import StatusPage from './routes/status';
import ThingtimeUrl from './routes/$';
import TestsPage from './routes/tests';
import Themes from './routes/themes';
import VercelPage from './routes/vercel';
import VerifyEmail from './routes/verify-email';
import Welcome from './routes/welcome';

const fetchJson = async <T,>(url: string, init: RequestInit = {}) => {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...init.headers
    }
  });

  if (!response.ok) {
    throw new Response(await response.text(), { status: response.status });
  }

  return (await response.json()) as T;
};

const rootLoader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return fetchJson<RootLoaderData>(`/api/root-data${url.search}`);
};

const currentUserLoader = async () => {
  const response = await fetchJson<{ user: RootLoaderData['user'] }>('/api/v1/auth/me');
  return response.user;
};

const requireGuest = (redirectTo: string) => async () => {
  if (await currentUserLoader()) {
    throw redirect(redirectTo);
  }

  return null;
};

const requireUser = (redirectTo: string) => async () => {
  if (!(await currentUserLoader())) {
    throw redirect(redirectTo);
  }

  return null;
};

const vercelDeploymentsLoader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return fetchJson(`/api/v1/vercel/deployments${url.search}`);
};

export const router = createBrowserRouter([
  {
    id: 'root',
    path: '/',
    element: <App />,
    loader: rootLoader,
    children: [
      { index: true, element: <Index /> },
      { path: 'branding', element: <Branding /> },
      { path: 'branding_old', element: <BrandingOld /> },
      { path: 'crypto', element: <CryptoPage /> },
      {
        path: 'docs',
        element: <DocsLayout />,
        children: [
          { index: true, element: <DocsIndex /> },
          { path: 'api', element: <DocsApi /> },
          { path: 'api/:group', element: <DocsApi /> },
          { path: 'api/:group/:docId', element: <DocsApi /> },
          { path: 'design', element: <DocsDesign /> },
          { path: 'design-system', element: <DocsDesignSystem /> },
          { path: 'concepts', element: <DocsConcepts /> },
          { path: 'schemas', element: <DocsSchemas /> }
        ]
      },
      { path: 'edge', element: <Edge /> },
      { path: 'feed', element: <Feed /> },
      { path: 'login', element: <Login />, loader: requireGuest('/profile') },
      {
        path: 'mongodb-status',
        element: <MongoStatusPage />,
        loader: () => fetchJson('/api/v1/mongodb/status-data')
      },
      { path: 'ode', element: <Ode /> },
      { path: 'profile', element: <Profile /> },
      { path: 'profile/:username', element: <Profile /> },
      { path: 'rainbow/*', element: <Rainbow /> },
      { path: 'raw', element: <Raw /> },
      { path: 'register', element: <Register />, loader: requireGuest('/welcome') },
      // password-reset + verification landing pages work logged-out by design
      // (the emailed token/link is the credential, not the session)
      { path: 'reset-password', element: <ResetPassword /> },
      { path: 'verify-email', element: <VerifyEmail /> },
      // Schema BROWSING/BUILDING lives at /schemas (standalone, like /search);
      // the registry reference docs moved to /docs/schemas.
      { path: 'schemas', element: <SchemasRoute /> },
      { path: 'search', element: <SearchRoute /> },
      {
        path: 'status',
        element: <StatusPage />,
        loader: () => fetchJson('/api/v1/vercel/status')
      },
      {
        path: 'vercel',
        element: <VercelPage />,
        loader: vercelDeploymentsLoader
      },
      { path: 'settings', element: <SettingsRoute /> },
      { path: 'tests', element: <TestsPage /> },
      { path: 'themes', element: <Themes /> },
      { path: 'welcome', element: <Welcome />, loader: requireUser('/register') },
      { path: '*', element: <ThingtimeUrl /> }
    ]
  }
]);
