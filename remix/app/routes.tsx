import { createBrowserRouter, redirect, type LoaderFunctionArgs } from 'react-router';

import App from './root';
import type { RootLoaderData } from './root-data.server';
import AppsRoute from './routes/apps';
import AppsManageRoute from './routes/apps-manage';
import Authorize from './routes/authorize';
import Branding from './routes/branding/_index';
import BrandingOld from './routes/branding_old';
import CryptoPage from './routes/crypto';
import DocsLayout from './routes/docs/DocsLayout';
import DocsApi from './routes/docs/api';
import DocsEmbed from './routes/docs/embed';
import DocsConcepts from './routes/docs/concepts/index';
import DocsDesign from './routes/docs/design';
import DocsDesignSystem from './routes/docs/design-system/index';
import DocsIndex from './routes/docs/index';
import MigrationsRoute from './routes/migrations';
import Feed from './routes/feed';
import Messages from './routes/messages';
import Index from './routes/_index';
import Login from './routes/login';
import AdminRoute from './routes/admin';
import SettingsRoute from './routes/settings';
import MediaPage from './routes/media';
import MongoStatusPage from './routes/mongodb-status';
import Ode from './routes/ode';
import PostPage from './routes/post';
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
import ThingsRoute from './routes/things';
import TestsPage from './routes/tests';
import Themes from './routes/themes';
import ThemesGallery from './routes/themes.gallery';
import ThingPage from './routes/thing';
import VercelPage from './routes/vercel';
import VerifyEmail from './routes/verify-email';
import Welcome from './routes/welcome';
import { shouldBootstrapTemporaryUser } from './utils/temporaryUserBootstrap';

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
  const rootData = await fetchJson<RootLoaderData>(`/api/root-data${url.search}`);

  if (!shouldBootstrapTemporaryUser(url.pathname, rootData.user)) {
    return rootData;
  }

  try {
    const temporary = await fetchJson<{ user: RootLoaderData['user'] }>('/api/v1/auth/temporary', { method: 'POST' });
    return temporary.user ? { ...rootData, user: temporary.user } : rootData;
  } catch {
    // Authentication remains recoverable through the existing login UI when
    // the bootstrap service is unavailable; never replace the whole route
    // with an error boundary for an optional first-session convenience.
    return rootData;
  }
};

const currentUserLoader = async () => {
  const response = await fetchJson<{ user: RootLoaderData['user'] }>('/api/v1/auth/me');
  return response.user;
};

const requireGuest = (redirectTo: string) => async () => {
  const user = await currentUserLoader();
  if (user && !user.temporary) {
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
      // "Login with Thingtime" popup (embed SDK) — no guest/user guard: it
      // handles both states itself (login form → consent screen).
      { path: 'authorize', element: <Authorize /> },
      // admin dashboard — no loader guard: it renders its own 🔐 card for
      // non-admins (same idiom as the MongoDB workbench)
      { path: 'admin', element: <AdminRoute /> },
      // browse everything each connected app stores for you — no guard: it
      // renders its own signed-out quiet state, like /settings
      { path: 'apps', element: <AppsRoute /> },
      { path: 'apps/manage', element: <AppsManageRoute /> },
      { path: 'branding', element: <Branding /> },
      { path: 'branding_old', element: <BrandingOld /> },
      { path: 'crypto', element: <CryptoPage /> },
      {
        path: 'docs',
        element: <DocsLayout />,
        children: [
          { index: true, element: <DocsIndex /> },
          { path: 'embed', element: <DocsEmbed /> },
          { path: 'api', element: <DocsApi /> },
          { path: 'api/:group', element: <DocsApi /> },
          { path: 'api/:group/:docId', element: <DocsApi /> },
          { path: 'design', element: <DocsDesign /> },
          { path: 'design-system', element: <DocsDesignSystem /> },
          { path: 'concepts', element: <DocsConcepts /> },
          { path: 'schemas', element: <DocsSchemas /> }
        ]
      },
      { path: 'feed', element: <Feed /> },
      { path: 'messages', element: <Messages />, loader: requireUser('/login') },
      { path: 'login', element: <Login />, loader: requireGuest('/profile') },
      // admin database-migrations console (Dev drawer → Migrations) — moved
      // out of /docs/schemas into its own page
      { path: 'migrations', element: <MigrationsRoute /> },
      {
        path: 'mongodb-status',
        element: <MongoStatusPage />,
        loader: () => fetchJson('/api/v1/mongodb/status-data')
      },
      { path: 'ode', element: <Ode /> },
      // shareable permalink for any post or comment (timestamps link here)
      { path: 'post/:id', element: <PostPage /> },
			// every attachment is a Thing — its own page with comments/reactions
			// (post lightbox + file rows deeplink here)
			{ path: 'media/:id', element: <MediaPage /> },
			// authenticated permalink for generic Things; protected migration
			// diagnostics switch to their current-admin, home-plane read endpoint
			{ path: 'thing/:id', element: <ThingPage /> },
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
      { path: 'themes/gallery', element: <ThemesGallery /> },
      // the unified Things browser claims EXACTLY /things; deeper /things/*
      // paths still reach the ThingtimeUrl tree viewer via the catch-all
      { path: 'things', element: <ThingsRoute /> },
      { path: 'welcome', element: <Welcome />, loader: requireUser('/register') },
      { path: '*', element: <ThingtimeUrl /> }
    ]
  }
]);
