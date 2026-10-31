// Shared canonical data routes for Nitro and Lopu's internal Action host.
// Keep account/control-plane routes out of this module: durable workflow
// bundling must not pull in login handlers and their native bcrypt installer.
type RouteModule = {
  loader?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
  action?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
};
export const actionDataRoutes: Record<string, () => Promise<RouteModule>> = {
  'v1/library/request': () => import('../../app/routes/api/v1/library/request/_request'),
  'v1/builder/workspaces': () => import('../../app/routes/api/v1/builder/workspaces/_workspaces'),
  'v1/components/browse': () => import('../../app/routes/api/v1/components/browse/_browse'),
  'v1/webpages/resolve': () => import('../../app/routes/api/v1/webpages/resolve/_resolve'),
  'v1/things/fork': () => import('../../app/routes/api/v1/things/fork/_fork'),
  'v1/things/import': () => import('../../app/routes/api/v1/things/import/_import'),
  'v1/things/export': () => import('../../app/routes/api/v1/things/export/_export'),
  'v1/webpages/demos': () => import('../../app/routes/api/v1/webpages/demos/_demos'),
  'v1/webpages/suites/install': () => import('../../app/routes/api/v1/webpages/suites/install/_install'),
  'v1/schemas': () => import('../../app/routes/api/v1/schemas/_schemas'),
  'v1/schemas/browse': () => import('../../app/routes/api/v1/schemas/browse/_browse'),
  'v1/things': () => import('../../app/routes/api/v1/things/_things'),
  'v1/things/actions': () => import('../../app/routes/api/v1/things/actions/_actions'),
  'v1/things/bulk': () => import('../../app/routes/api/v1/things/bulk/_bulk'),
  'v1/things/comment': () => import('../../app/routes/api/v1/things/comment/_comment'),
  'v1/things/delete': () => import('../../app/routes/api/v1/things/delete/_delete'),
  'v1/things/feed': () => import('../../app/routes/api/v1/things/feed/_feed'),
  'v1/things/react': () => import('../../app/routes/api/v1/things/react/_react'),
  'v1/things/reactions-recent': () => import('../../app/routes/api/v1/things/reactions-recent/_reactions-recent'),
  'v1/things/quota': () => import('../../app/routes/api/v1/things/quota/_quota'),
  'v1/things/rss': () => import('../../app/routes/api/v1/things/rss/_rss'),
  'v1/things/save': () => import('../../app/routes/api/v1/things/save/_save'),
  'v1/things/saved': () => import('../../app/routes/api/v1/things/saved/_saved'),
  'v1/things/search': () => import('../../app/routes/api/v1/things/search/_search'),
  'v1/things/share': () => import('../../app/routes/api/v1/things/share/_share'),
  'v1/things/trending': () => import('../../app/routes/api/v1/things/trending/_trending'),
  'v1/things/update': () => import('../../app/routes/api/v1/things/update/_update'),
  'v1/things/user': () => import('../../app/routes/api/v1/things/user/_user'),
  'v1/things/views': () => import('../../app/routes/api/v1/things/views/_views'),
  'v1/things/vote': () => import('../../app/routes/api/v1/things/vote/_vote'),
  'v1/things/updown': () => import('../../app/routes/api/v1/things/updown/_updown'),
};
