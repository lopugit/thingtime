import type { ComponentType } from 'react';
import { createBrowserRouter, redirect, type LoaderFunctionArgs } from 'react-router';

import App from './root';
import type { RootLoaderData } from './root-data.server';
// Eager: the root shell plus the screens on the primary path — the landing
// page, the authenticated home, auth entry points, permalinks and the
// catch-all tree viewer. These are either the first paint or one click from
// it, so a separate chunk fetch would cost more than it saves.
import Authorize from './routes/authorize';
import Explore from './routes/explore';
import Feed from './routes/feed';
import Index from './routes/_index';
import Login from './routes/login';
import MediaPage from './routes/media';
import PostPage from './routes/post';
import DeploymentPeersRoute from './routes/peers';
import Profile from './routes/profile';
import Register from './routes/register';
import ResetPassword from './routes/reset-password';
import SavedRoute from './routes/saved';
import ThingtimeUrl from './routes/$';
import ThingPage from './routes/thing';
import VerifyEmail from './routes/verify-email';
import Welcome from './routes/welcome';
import { recoverStaleChunk } from './utils/staleChunkRecovery';
import { shouldBootstrapTemporaryUser } from './utils/temporaryUserBootstrap';

// Everything else is code-split. Statically importing every route put the
// admin dashboard, the migrations console and the whole API-docs registry into
// the single entry chunk, so an anonymous visitor to the landing page
// downloaded and parsed all of it before first paint.
//
// React Router resolves `lazy` when the route is first matched and caches the
// module, so a screen costs one chunk fetch on first visit and nothing after.
// Routes that declare a `loader` here keep it static — the loader fetch and
// the chunk fetch then overlap instead of queueing.
// Chunk fetches fail with "Failed to fetch dynamically imported module" when
// a redeploy replaced the hashed assets an already-open tab's HTML points at.
// One hard reload fetches the fresh HTML + chunk graph; a session guard
// (cleared after 10 healthy seconds in entry.client) prevents reload loops
// when the network itself is down.
const lazyRoute = (load: () => Promise<{ default: ComponentType<any> }>) => async () => ({
  Component: (await load().catch(recoverStaleChunk)).default
});

// Rendered while the router resolves the initial navigation — the root
// loader's /api/root-data fetch, and on a direct visit to a split route, its
// chunk. React Router warns when this is missing and renders nothing, which
// is a white flash on a themed page.
//
// Deliberately an empty surface rather than a spinner or skeleton: the
// optimistic-render house rule says never flash a loading state, so this only
// holds the page background steady until the real screen takes over.
const HydrateFallback = () => (
  <div style={{ minHeight: '100vh', background: 'var(--chakra-colors-chakra-body-bg, transparent)' }} />
);

const fetchJson = async <T,>(url: string, init: RequestInit = {}) => {
  const response = await fetch(url, {
    ...init,
    // Account/root responses are explicitly current-state reads. Electron's
    // loopback origin can reuse a prior ephemeral port after relaunch, so a
    // browser cache entry from a different endpoint must never determine the
    // active account, branch label, or device pairing surface.
    cache: init.cache || 'no-store',
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
    HydrateFallback,
    loader: rootLoader,
    children: [
      { index: true, element: <Index /> },
      // "Login with Thingtime" popup (embed SDK) — no guest/user guard: it
      // handles both states itself (login form → consent screen).
      { path: 'authorize', element: <Authorize /> },
      // admin dashboard — no loader guard: it renders its own 🔐 card for
      // non-admins (same idiom as the MongoDB workbench)
      { path: 'admin', lazy: lazyRoute(() => import('./routes/admin')) },
      { path: 'admin/:section', lazy: lazyRoute(() => import('./routes/admin')) },
      // browse everything each connected app stores for you — no guard: it
      // renders its own signed-out quiet state, like /settings
      { path: 'apps', lazy: lazyRoute(() => import('./routes/apps')) },
      { path: 'apps/manage', lazy: lazyRoute(() => import('./routes/apps-manage')) },
      { path: 'branding', lazy: lazyRoute(() => import('./routes/branding/_index')) },
      { path: 'branding_old', lazy: lazyRoute(() => import('./routes/branding_old')) },
      // the block-based site builder — create webpages from component things;
      // ?page=<id> opens the canvas (site pages included)
      { path: 'builder', lazy: lazyRoute(() => import('./routes/builder')) },
      // published block-based webpages (reserved prefix — outranks the * catch-all)
      { path: 'p/:id', lazy: lazyRoute(() => import('./routes/p')) },
      // the storybook-style design-system docs own the canonical short URL too
      { path: 'design-system', loader: () => redirect('/docs/design-system'), element: <HydrateFallback /> },
      { path: 'crypto', lazy: lazyRoute(() => import('./routes/crypto')) },
      {
        path: 'docs',
        lazy: lazyRoute(() => import('./routes/docs/DocsLayout')),
        children: [
          { index: true, lazy: lazyRoute(() => import('./routes/docs/index')) },
          { path: 'mcp', lazy: lazyRoute(() => import('./routes/docs/mcp')) },
          { path: 'embed', lazy: lazyRoute(() => import('./routes/docs/embed')) },
          { path: 'api', lazy: lazyRoute(() => import('./routes/docs/api')) },
          { path: 'api/:group', lazy: lazyRoute(() => import('./routes/docs/api')) },
          { path: 'api/:group/:docId', lazy: lazyRoute(() => import('./routes/docs/api')) },
          { path: 'design', lazy: lazyRoute(() => import('./routes/docs/design')) },
          { path: 'design-system', lazy: lazyRoute(() => import('./routes/docs/design-system/index')) },
          { path: 'concepts', lazy: lazyRoute(() => import('./routes/docs/concepts/index')) },
          { path: 'schemas', lazy: lazyRoute(() => import('./routes/docs/schemas')) }
        ]
      },
      // public trending board — guest-visible like /feed
      { path: 'explore', element: <Explore /> },
      { path: 'feed', element: <Feed /> },
      { path: 'messages', lazy: lazyRoute(() => import('./routes/messages')), loader: requireUser('/login') },
      { path: 'login', element: <Login />, loader: requireGuest('/profile') },
      // admin database-migrations console (Dev drawer → Migrations) — moved
      // out of /docs/schemas into its own page
      { path: 'migrations', lazy: lazyRoute(() => import('./routes/migrations')) },
      // mongodb-status renders from its native-section registry list; the
      // sections' shared hook fetches — no navigation-blocking loader
      { path: 'mongodb-status', lazy: lazyRoute(() => import('./routes/mongodb-status')) },
      { path: 'ode', lazy: lazyRoute(() => import('./routes/ode')) },
      // shareable permalink for any post or comment (timestamps link here)
      { path: 'post/:id', element: <PostPage /> },
			// Developer-only, admin-gated deployment mesh diagnostics. The page
			// itself renders the same shareable quiet gate as /admin.
			{ path: 'peers', element: <DeploymentPeersRoute /> },
			// every attachment is a Thing — its own page with comments/reactions
			// (post lightbox + file rows deeplink here)
			{ path: 'media/:id', element: <MediaPage /> },
			// authenticated permalink for generic Things; protected migration
			// diagnostics switch to their current-admin, home-plane read endpoint
			{ path: 'thing/:id', element: <ThingPage /> },
      { path: 'profile', element: <Profile /> },
      { path: 'profile/:username', element: <Profile /> },
      { path: 'rainbow/*', lazy: lazyRoute(() => import('./routes/rainbow.$')) },
      { path: 'raw', lazy: lazyRoute(() => import('./routes/raw')) },
      { path: 'register', element: <Register />, loader: requireGuest('/welcome') },
      // password-reset + verification landing pages work logged-out by design
      // (the emailed token/link is the credential, not the session)
      { path: 'reset-password', element: <ResetPassword /> },
      { path: 'verify-email', element: <VerifyEmail /> },
      // the viewer's Saved library — no loader guard: it renders its own
      // signed-out quiet state, like /apps
      { path: 'saved', element: <SavedRoute /> },
      // the viewer's full notification history (search + category/type/
      // unread/date filters in the URL) — same signed-out quiet state posture
      { path: 'notifications', lazy: lazyRoute(() => import('./routes/notifications')) },
      // Subspaces — Reddit-style communities (components/Subspaces)
      { path: 's', lazy: lazyRoute(() => import('./routes/subspaces')) },
      { path: 's/:slug', lazy: lazyRoute(() => import('./routes/subspace')) },
      { path: 's/:slug/mod', lazy: lazyRoute(() => import('./routes/subspace-mod')), loader: requireUser('/login') },
      // Schema BROWSING/BUILDING lives at /schemas (standalone, like /search);
      // the registry reference docs moved to /docs/schemas.
      { path: 'schemas', lazy: lazyRoute(() => import('./routes/schemas')) },
      // Actions: declarative capability-bounded programs — browse + the
      // per-action inspector (inputs, effects, limits, run panel, history)
      { path: 'actions', lazy: lazyRoute(() => import('./routes/actions')) },
      { path: 'actions/:key', lazy: lazyRoute(() => import('./routes/action-detail')) },
      // UI component library: /schemas' UI-first sibling; every component
      // family gets its own deep-linked page + /docs twin
      { path: 'components', lazy: lazyRoute(() => import('./routes/components')) },
      { path: 'components/:key', lazy: lazyRoute(() => import('./routes/component-detail')) },
      {
        path: 'components/:key/docs',
        lazy: async () => ({ Component: (await import('./routes/component-detail')).ComponentDetailDocs })
      },
      { path: 'search', lazy: lazyRoute(() => import('./routes/search')) },
      // status renders from its native-section registry list; the sections'
      // shared hook fetches — no navigation-blocking loader
      { path: 'status', lazy: lazyRoute(() => import('./routes/status')) },
      {
        path: 'vercel',
        lazy: lazyRoute(() => import('./routes/vercel')),
        loader: vercelDeploymentsLoader
      },
      { path: 'settings', lazy: lazyRoute(() => import('./routes/settings')) },
      { path: 'tests', lazy: lazyRoute(() => import('./routes/tests')) },
      { path: 'themes', lazy: lazyRoute(() => import('./routes/themes')) },
      { path: 'themes/gallery', lazy: lazyRoute(() => import('./routes/themes.gallery')) },
      // the unified Things browser claims EXACTLY /things; deeper /things/*
      // paths still reach the ThingtimeUrl tree viewer via the catch-all
      { path: 'things', lazy: lazyRoute(() => import('./routes/things')) },
      { path: 'welcome', element: <Welcome />, loader: requireUser('/register') },
      { path: '*', element: <ThingtimeUrl /> }
    ]
  }
]);
