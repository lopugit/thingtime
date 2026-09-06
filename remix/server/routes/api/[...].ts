import { defineHandler } from 'nitro/h3';

import { getRequestMongoEndpoint, runWithMongoEndpoint } from '../../../app/api/utils/mongodb/endpoint';
import { CHATGPT_AUTHORIZE_PATH, CHATGPT_DYNAMIC_CLIENT_REGISTRATION_PATH, CHATGPT_MCP_PATH, CHATGPT_OAUTH_RELAY_PATH, CHATGPT_TOKEN_PATH } from '../../../app/api/utils/chatgpt/pluginCore';
import { StorageMutationError } from '../../../app/api/utils/storage/storageCore';
import { proxyApiRequestToFallback, shouldProxyApiToFallback } from '../../utils/apiFallback';

type RouteModule = {
  loader?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
  action?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
};

export const routeModules: Record<string, () => Promise<RouteModule>> = {
  'v1/admin/ai/models': () => import('../../../app/routes/api/v1/admin/ai/models/_models'),
  'v1/admin/apps': () => import('../../../app/routes/api/v1/admin/apps/_apps'),
  'v1/admin/apps/revoke': () => import('../../../app/routes/api/v1/admin/apps/revoke/_revoke'),
  'v1/admin/ci': () => import('../../../app/routes/api/v1/admin/ci/_ci'),
  'v1/admin/components/seed': () => import('../../../app/routes/api/v1/admin/components/seed/_seed'),
  'v1/admin/webpages/seed': () => import('../../../app/routes/api/v1/admin/webpages/seed/_seed'),
  'v1/admin/webpages/seed-demos': () => import('../../../app/routes/api/v1/admin/webpages/seed-demos/_seed-demos'),
  'v1/admin/ci/automations': () => import('../../../app/routes/api/v1/admin/ci/automations/_automations'),
  'v1/admin/ci/dispatch': () => import('../../../app/routes/api/v1/admin/ci/dispatch/_dispatch'),
  'v1/admin/ci/previews': () => import('../../../app/routes/api/v1/admin/ci/previews/_previews'),
  'v1/admin/ci/stacks': () => import('../../../app/routes/api/v1/admin/ci/stacks/_stacks'),
  'v1/admin/ci/credentials': () => import('../../../app/routes/api/v1/admin/ci/credentials/_credentials'),
  'v1/admin/ci/reconcile': () => import('../../../app/routes/api/v1/admin/ci/reconcile/_reconcile'),
  'v1/admin/integrations': () => import('../../../app/routes/api/v1/admin/integrations/_integrations'),
  'v1/admin/links': () => import('../../../app/routes/api/v1/admin/links/_links'),
  'v1/admin/marketing/publications': () => import('../../../app/routes/api/v1/admin/marketing/publications/_publications'),
  'v1/admin/migrations': () => import('../../../app/routes/api/v1/admin/migrations/_migrations'),
  'v1/admin/moderation': () => import('../../../app/routes/api/v1/admin/moderation/_moderation'),
	'v1/admin/migrations/diagnostic': () => import('../../../app/routes/api/v1/admin/migrations/diagnostic/_diagnostic'),
  'v1/admin/migrations/run': () => import('../../../app/routes/api/v1/admin/migrations/run/_run'),
	'v1/admin/peers': () => import('../../../app/routes/api/v1/admin/peers/_peers'),
  'v1/admin/rate-limits': () => import('../../../app/routes/api/v1/admin/rate-limits/_rate-limits'),
  'v1/admin/set-admin': () => import('../../../app/routes/api/v1/admin/set-admin/_set-admin'),
  'v1/admin/subscriptions': () => import('../../../app/routes/api/v1/admin/subscriptions/_subscriptions'),
  'v1/admin/tiers': () => import('../../../app/routes/api/v1/admin/tiers/_tiers'),
  'v1/admin/users': () => import('../../../app/routes/api/v1/admin/users/_users'),
  'v1/admin/users/overview': () => import('../../../app/routes/api/v1/admin/users/overview/_overview'),
  'v1/admin/users/public-uploads': () => import('../../../app/routes/api/v1/admin/users/public-uploads/_public-uploads'),
  'v1/peers': () => import('../../../app/routes/api/v1/peers/_peers'),
  'v1/peers/sync': () => import('../../../app/routes/api/v1/peers/sync/_sync'),
  'v1/integrations/github/webhook': () => import('../../../app/routes/api/v1/integrations/github/webhook/_webhook'),
  [CHATGPT_MCP_PATH.replace('/api/', '')]: () => import('../../../app/routes/api/v1/integrations/chatgpt/mcp/_mcp'),
  [CHATGPT_AUTHORIZE_PATH.replace('/api/', '')]: () => import('../../../app/routes/api/v1/integrations/chatgpt/oauth/authorize/_authorize'),
  [CHATGPT_TOKEN_PATH.replace('/api/', '')]: () => import('../../../app/routes/api/v1/integrations/chatgpt/oauth/token/_token'),
  [CHATGPT_DYNAMIC_CLIENT_REGISTRATION_PATH.replace('/api/', '')]: () => import('../../../app/routes/api/v1/integrations/chatgpt/oauth/register/_register'),
  [CHATGPT_OAUTH_RELAY_PATH.replace('/api/', '')]: () => import('../../../app/routes/api/v1/integrations/chatgpt/oauth/relay/_relay'),
  'v1/integrations/ci/route': () => import('../../../app/routes/api/v1/integrations/ci/route/_route'),
  'v1/integrations/ci/credentials': () => import('../../../app/routes/api/v1/integrations/ci/credentials/_credentials'),
  'v1/integrations/ci/progress': () => import('../../../app/routes/api/v1/integrations/ci/progress/_progress'),
  'v1/integrations/vercel/webhook': () => import('../../../app/routes/api/v1/integrations/vercel/webhook/_webhook'),
  'v1/algorithms': () => import('../../../app/routes/api/v1/algorithms/_algorithms'),
  'v1/algorithms/active': () => import('../../../app/routes/api/v1/algorithms/active/_active'),
  'v1/algorithms/delete': () => import('../../../app/routes/api/v1/algorithms/delete/_delete'),
  'v1/algorithms/shared': () => import('../../../app/routes/api/v1/algorithms/shared/_shared'),
  'v1/algorithms/track': () => import('../../../app/routes/api/v1/algorithms/track/_track'),
  'v1/algorithms/update': () => import('../../../app/routes/api/v1/algorithms/update/_update'),
  'v1/ai/connections': () => import('../../../app/routes/api/v1/ai/connections/_connections'),
  'v1/ai/models': () => import('../../../app/routes/api/v1/ai/models/_models'),
  'v1/app-data': () => import('../../../app/routes/api/v1/app-data/_app-data'),
  'v1/app-data/delete': () => import('../../../app/routes/api/v1/app-data/delete/_delete'),
  'v1/app-data/shared': () => import('../../../app/routes/api/v1/app-data/shared/_shared'),
  'v1/app-data/usage': () => import('../../../app/routes/api/v1/app-data/usage/_usage'),
  'v1/apps': () => import('../../../app/routes/api/v1/apps/_apps'),
  'v1/apps/data-summary': () => import('../../../app/routes/api/v1/apps/data-summary/_data-summary'),
  'v1/apps/data/delete-all': () => import('../../../app/routes/api/v1/apps/data/delete-all/_delete-all'),
  'v1/apps/data/shared': () => import('../../../app/routes/api/v1/apps/data/shared/_shared'),
  'v1/apps/delete': () => import('../../../app/routes/api/v1/apps/delete/_delete'),
  'v1/apps/public': () => import('../../../app/routes/api/v1/apps/public/_public'),
  'v1/apps/storage': () => import('../../../app/routes/api/v1/apps/storage/_storage'),
  'v1/apps/update': () => import('../../../app/routes/api/v1/apps/update/_update'),
  'v1/attachments/backfill-detected-types': () => import('../../../app/routes/api/v1/attachments/backfill-detected-types/_backfill-detected-types'),
  'v1/attachments/annotate': () => import('../../../app/routes/api/v1/attachments/annotate/_annotate'),
  'v1/attachments/content': () => import('../../../app/routes/api/v1/attachments/content/_content'),
  'v1/attachments/cleanup': () => import('../../../app/routes/api/v1/attachments/cleanup/_cleanup'),
  'v1/moderation/sweep': () => import('../../../app/routes/api/v1/moderation/sweep/_sweep'),
  'v1/attachments/delete': () => import('../../../app/routes/api/v1/attachments/delete/_delete'),
  'v1/attachments/link': () => import('../../../app/routes/api/v1/attachments/link/_link'),
  'v1/attachments/uploads': () => import('../../../app/routes/api/v1/attachments/uploads/_uploads'),
  'v1/attachments/uploads/abort': () => import('../../../app/routes/api/v1/attachments/uploads/abort/_abort'),
  'v1/attachments/uploads/complete': () => import('../../../app/routes/api/v1/attachments/uploads/complete/_complete'),
  'v1/attachments/uploads/parts': () => import('../../../app/routes/api/v1/attachments/uploads/parts/_parts'),
  'v1/auth/accounts': () => import('../../../app/routes/api/v1/auth/accounts/_accounts'),
  'v1/auth/accounts/assume': () => import('../../../app/routes/api/v1/auth/accounts/assume/_assume'),
  'v1/auth/accounts/owned': () => import('../../../app/routes/api/v1/auth/accounts/owned/_owned'),
  'v1/auth/accounts/remove': () => import('../../../app/routes/api/v1/auth/accounts/remove/_remove'),
  'v1/auth/accounts/switch': () => import('../../../app/routes/api/v1/auth/accounts/switch/_switch'),
  'v1/auth/account-hints': () => import('../../../app/routes/api/v1/auth/account-hints/_account-hints'),
  'v1/auth/account-hints/resolve': () => import('../../../app/routes/api/v1/auth/account-hints/resolve/_resolve'),
  'v1/auth/introspect': () => import('../../../app/routes/api/v1/auth/introspect/_introspect'),
  'v1/auth/sso-handoff': () => import('../../../app/routes/api/v1/auth/sso-handoff/_sso-handoff'),
  'v1/auth/sso-session': () => import('../../../app/routes/api/v1/auth/sso-session/_sso-session'),
  'v1/fedcm/config': () => import('../../../app/routes/api/v1/fedcm/config/_config'),
  'v1/fedcm/accounts': () => import('../../../app/routes/api/v1/fedcm/accounts/_accounts'),
  'v1/fedcm/client-metadata': () => import('../../../app/routes/api/v1/fedcm/client-metadata/_client-metadata'),
  'v1/fedcm/assertion': () => import('../../../app/routes/api/v1/fedcm/assertion/_assertion'),
  'v1/auth/jwks': () => import('../../../app/routes/api/v1/auth/jwks/_jwks'),
  'v1/auth/logout': () => import('../../../app/routes/api/v1/auth/logout/_logout'),
  'v1/auth/me': () => import('../../../app/routes/api/v1/auth/me/_me'),
  'v1/auth/passkeys': () => import('../../../app/routes/api/v1/auth/passkeys/_passkeys'),
  'v1/auth/passkeys/register-options': () => import('../../../app/routes/api/v1/auth/passkeys/register-options/_register-options'),
  'v1/auth/passkeys/register': () => import('../../../app/routes/api/v1/auth/passkeys/register/_register'),
  'v1/auth/passkeys/login-options': () => import('../../../app/routes/api/v1/auth/passkeys/login-options/_login-options'),
  'v1/auth/passkeys/login': () => import('../../../app/routes/api/v1/auth/passkeys/login/_login'),
  'v1/auth/passkeys/update': () => import('../../../app/routes/api/v1/auth/passkeys/update/_update'),
  'v1/auth/passkeys/revoke': () => import('../../../app/routes/api/v1/auth/passkeys/revoke/_revoke'),
  'v1/auth/passkeys/delete': () => import('../../../app/routes/api/v1/auth/passkeys/delete/_delete'),
  'v1/auth/password-reset': () => import('../../../app/routes/api/v1/auth/password-reset/_password-reset'),
  'v1/auth/password-reset/confirm': () => import('../../../app/routes/api/v1/auth/password-reset/confirm/_confirm'),
  'v1/auth/register': () => import('../../../app/routes/api/v1/auth/register/_register'),
  'v1/auth/temporary': () => import('../../../app/routes/api/v1/auth/temporary/_temporary'),
  'v1/auth/resend-verification': () => import('../../../app/routes/api/v1/auth/resend-verification/_resend-verification'),
  'v1/auth/service-account': () => import('../../../app/routes/api/v1/auth/service-account/_service-account'),
  'v1/auth/two-factor': () => import('../../../app/routes/api/v1/auth/two-factor/_two-factor'),
  'v1/auth/verify-email': () => import('../../../app/routes/api/v1/auth/verify-email/_verify-email'),
  'v1/chats': () => import('../../../app/routes/api/v1/chats/_chats'),
  'v1/chats/get': () => import('../../../app/routes/api/v1/chats/get/_get'),
  'v1/chats/leave': () => import('../../../app/routes/api/v1/chats/leave/_leave'),
  'v1/chats/members': () => import('../../../app/routes/api/v1/chats/members/_members'),
  'v1/chats/messages': () => import('../../../app/routes/api/v1/chats/messages/_messages'),
  'v1/chats/messages/delete': () => import('../../../app/routes/api/v1/chats/messages/delete/_delete'),
  'v1/chats/messages/edit': () => import('../../../app/routes/api/v1/chats/messages/edit/_edit'),
  'v1/chats/react': () => import('../../../app/routes/api/v1/chats/react/_react'),
  'v1/chats/read': () => import('../../../app/routes/api/v1/chats/read/_read'),
  'v1/chats/requests': () => import('../../../app/routes/api/v1/chats/requests/_requests'),
  'v1/chats/settings': () => import('../../../app/routes/api/v1/chats/settings/_settings'),
  'v1/chats/update': () => import('../../../app/routes/api/v1/chats/update/_update'),
  'v1/chats/updates': () => import('../../../app/routes/api/v1/chats/updates/_updates'),
	'v1/devices': () => import('../../../app/routes/api/v1/devices/_devices'),
	'v1/devices/approvals': () => import('../../../app/routes/api/v1/devices/approvals/_approvals'),
	'v1/devices/commands': () => import('../../../app/routes/api/v1/devices/commands/_commands'),
	'v1/devices/events': () => import('../../../app/routes/api/v1/devices/events/_events'),
	'v1/devices/node/commands': () => import('../../../app/routes/api/v1/devices/node/commands/_commands'),
	'v1/devices/node/live-sync': () => import('../../../app/routes/api/v1/devices/node/live-sync/_live-sync'),
	'v1/devices/node/state': () => import('../../../app/routes/api/v1/devices/node/state/_state'),
	'v1/devices/node/sync': () => import('../../../app/routes/api/v1/devices/node/sync/_sync'),
	'v1/devices/pairing': () => import('../../../app/routes/api/v1/devices/pairing/_pairing'),
	'v1/devices/pairing/claim': () => import('../../../app/routes/api/v1/devices/pairing/claim/_claim'),
	'v1/devices/permissions': () => import('../../../app/routes/api/v1/devices/permissions/_permissions'),
	'v1/devices/screen': () => import('../../../app/routes/api/v1/devices/screen/_screen'),
	'v1/watch/pairing': () => import('../../../app/routes/api/v1/watch/pairing/_pairing'),
	'v1/watch/sync': () => import('../../../app/routes/api/v1/watch/sync/_sync'),
	'v1/watch/things': () => import('../../../app/routes/api/v1/watch/things/_things'),
  'v1/communities': () => import('../../../app/routes/api/v1/communities/_communities'),
  'v1/communities/get': () => import('../../../app/routes/api/v1/communities/get/_get'),
  'v1/communities/invites': () => import('../../../app/routes/api/v1/communities/invites/_invites'),
  'v1/communities/join': () => import('../../../app/routes/api/v1/communities/join/_join'),
  'v1/communities/members': () => import('../../../app/routes/api/v1/communities/members/_members'),
  'v1/communities/sections': () => import('../../../app/routes/api/v1/communities/sections/_sections'),
  'v1/communities/update': () => import('../../../app/routes/api/v1/communities/update/_update'),
  'v1/crypto': () => import('../../../app/routes/api/v1/crypto/_crypto'),
  'v1/deployment-links': () => import('../../../app/routes/api/v1/deployment-links/_deployment-links'),
  'v1/deployment-links/sync': () => import('../../../app/routes/api/v1/deployment-links/sync/_sync'),
  'v1/deployment-links/token': () => import('../../../app/routes/api/v1/deployment-links/token/_token'),
  'v1/email/config': () => import('../../../app/routes/api/v1/email/config/_config'),
  'v1/email/test-otp': () => import('../../../app/routes/api/v1/email/test-otp/_test-otp'),
  'v1/embed/things': () => import('../../../app/routes/api/v1/embed/things/_things'),
  'v1/emojis': () => import('../../../app/routes/api/v1/emojis/_emojis'),
  'v1/emojis/delete': () => import('../../../app/routes/api/v1/emojis/delete/_delete'),
  'v1/health/frontend': () => import('../../../app/routes/api/v1/health/frontend/_frontend'),
  'v1/health/mongodb': () => import('../../../app/routes/api/v1/health/mongodb/_mongodb'),
  'v1/health/nitro': () => import('../../../app/routes/api/v1/health/nitro/_nitro'),
  'v1/health/vercel': () => import('../../../app/routes/api/v1/health/vercel/_vercel'),
  'v1/login': () => import('../../../app/routes/api/v1/login/_login'),
  'v1/lopu/musing': () => import('../../../app/routes/api/v1/lopu/musing/_musing'),
  'v1/lopu/chats': () => import('../../../app/routes/api/v1/lopu/chats/_chats'),
  'v1/lopu/chats/update': () => import('../../../app/routes/api/v1/lopu/chats/update/_update'),
  'v1/lopu/chats/delete': () => import('../../../app/routes/api/v1/lopu/chats/delete/_delete'),
  'v1/lopu/chats/reply': () => import('../../../app/routes/api/v1/lopu/chats/reply/_reply'),
	'v1/lopu/vault': () => import('../../../app/routes/api/v1/lopu/vault/_vault'),
	'v1/lopu/voice/reply': () => import('../../../app/routes/api/v1/lopu/voice/reply/_reply'),
	'v1/lopu/voice/session': () => import('../../../app/routes/api/v1/lopu/voice/session/_session'),
  'v1/mongodb/endpoint': () => import('../../../app/routes/api/v1/mongodb/endpoint/_endpoint'),
  'v1/mongodb/endpoints': () => import('../../../app/routes/api/v1/mongodb/endpoints/_endpoints'),
  'v1/mongodb/get-connection': () => import('../../../app/routes/api/v1/mongodb/get-connection/_get-connection'),
  'v1/mongodb/populate': () => import('../../../app/routes/api/v1/mongodb/populate/_populate'),
  'v1/mongodb/raw-results': () => import('../../../app/routes/api/v1/mongodb/raw-results/_raw-results'),
  'v1/mongodb/status': () => import('../../../app/routes/api/v1/mongodb/status/_status'),
  'v1/mongodb/status-data': () => import('../../../app/routes/api/v1/mongodb/status-data/_status-data'),
  'v1/notifications': () => import('../../../app/routes/api/v1/notifications/_notifications'),
	'v1/notifications/devices': () => import('../../../app/routes/api/v1/notifications/devices/_devices'),
	'v1/notifications/email/unsubscribe': () => import('../../../app/routes/api/v1/notifications/email/unsubscribe/_unsubscribe'),
	'v1/notifications/email/weekly-summary': () => import('../../../app/routes/api/v1/notifications/email/weekly-summary/_weekly-summary'),
  'v1/notifications/read': () => import('../../../app/routes/api/v1/notifications/read/_read'),
  'v1/notifications/settings': () => import('../../../app/routes/api/v1/notifications/settings/_settings'),
  'v1/oauth/authorize': () => import('../../../app/routes/api/v1/oauth/authorize/_authorize'),
  'v1/oauth/desktop/authorize': () => import('../../../app/routes/api/v1/oauth/desktop/authorize/_authorize'),
  'v1/oauth/grants': () => import('../../../app/routes/api/v1/oauth/grants/_grants'),
  'v1/oauth/grants/revoke': () => import('../../../app/routes/api/v1/oauth/grants/revoke/_revoke'),
  'v1/oauth/sandbox': () => import('../../../app/routes/api/v1/oauth/sandbox/_sandbox'),
  'v1/oauth/token': () => import('../../../app/routes/api/v1/oauth/token/_token'),
  'v1/oauth/scopes': () => import('../../../app/routes/api/v1/oauth/scopes/_scopes'),
  'v1/oauth/shared': () => import('../../../app/routes/api/v1/oauth/shared/_shared'),
  'v1/oauth/userinfo': () => import('../../../app/routes/api/v1/oauth/userinfo/_userinfo'),
  'v1/actions/run': () => import('../../../app/routes/api/v1/actions/run/_run'),
  'v1/actions/runs': () => import('../../../app/routes/api/v1/actions/runs/_runs'),
  'v1/components/browse': () => import('../../../app/routes/api/v1/components/browse/_browse'),
  'v1/marketing/publications': () => import('../../../app/routes/api/v1/marketing/publications/_publications'),
  'v1/webpages/resolve': () => import('../../../app/routes/api/v1/webpages/resolve/_resolve'),
  'v1/webpages/demos': () => import('../../../app/routes/api/v1/webpages/demos/_demos'),
  'v1/webpages/suites/install': () => import('../../../app/routes/api/v1/webpages/suites/install/_install'),
  'v1/network-probe/ping': () => import('../../../app/routes/api/v1/network-probe/ping/_ping'),
  'v1/network-probe/download': () => import('../../../app/routes/api/v1/network-probe/download/_download'),
  'v1/network-probe/upload': () => import('../../../app/routes/api/v1/network-probe/upload/_upload'),
  'v1/schemas': () => import('../../../app/routes/api/v1/schemas/_schemas'),
  'v1/schemas/browse': () => import('../../../app/routes/api/v1/schemas/browse/_browse'),
  'v1/settings/lopu-chat-defaults': () => import('../../../app/routes/api/v1/settings/lopu-chat-defaults/_lopu-chat-defaults'),
  'v1/settings/pr-conflict-auto-resolver-model-waterfall': () =>
		import('../../../app/routes/api/v1/settings/pr-conflict-auto-resolver-model-waterfall/_pr-conflict-auto-resolver-model-waterfall'),
  'v1/teapot': () => import('../../../app/routes/api/v1/teapot/_teapot'),
  'v1/template': () => import('../../../app/routes/api/v1/template/_template'),
  'v1/themes': () => import('../../../app/routes/api/v1/themes/_themes'),
  'v1/themes/active': () => import('../../../app/routes/api/v1/themes/active/_active'),
  'v1/themes/delete': () => import('../../../app/routes/api/v1/themes/delete/_delete'),
  'v1/themes/shared': () => import('../../../app/routes/api/v1/themes/shared/_shared'),
  'v1/things': () => import('../../../app/routes/api/v1/things/_things'),
  'v1/things/bulk': () => import('../../../app/routes/api/v1/things/bulk/_bulk'),
  'v1/tiers': () => import('../../../app/routes/api/v1/tiers/_tiers'),
  'v1/tokens': () => import('../../../app/routes/api/v1/tokens/_tokens'),
  'v1/tokens/revoke': () => import('../../../app/routes/api/v1/tokens/revoke/_revoke'),
  'v1/tokens/self': () => import('../../../app/routes/api/v1/tokens/self/_self'),
  'v1/things/comment': () => import('../../../app/routes/api/v1/things/comment/_comment'),
  'v1/things/delete': () => import('../../../app/routes/api/v1/things/delete/_delete'),
  'v1/things/feed': () => import('../../../app/routes/api/v1/things/feed/_feed'),
  'v1/things/react': () => import('../../../app/routes/api/v1/things/react/_react'),
  'v1/things/reactions-recent': () => import('../../../app/routes/api/v1/things/reactions-recent/_reactions-recent'),
  'v1/things/quota': () => import('../../../app/routes/api/v1/things/quota/_quota'),
  'v1/things/rss': () => import('../../../app/routes/api/v1/things/rss/_rss'),
	'v1/things/reveal': () => import('../../../app/routes/api/v1/things/reveal/_reveal'),
  'v1/things/save': () => import('../../../app/routes/api/v1/things/save/_save'),
  'v1/things/saved': () => import('../../../app/routes/api/v1/things/saved/_saved'),
  'v1/things/search': () => import('../../../app/routes/api/v1/things/search/_search'),
  'v1/things/share': () => import('../../../app/routes/api/v1/things/share/_share'),
  'v1/things/trending': () => import('../../../app/routes/api/v1/things/trending/_trending'),
  'v1/things/update': () => import('../../../app/routes/api/v1/things/update/_update'),
  'v1/things/user': () => import('../../../app/routes/api/v1/things/user/_user'),
  'v1/things/views': () => import('../../../app/routes/api/v1/things/views/_views'),
  'v1/things/vote': () => import('../../../app/routes/api/v1/things/vote/_vote'),
  'v1/users/activity': () => import('../../../app/routes/api/v1/users/activity/_activity'),
  'v1/users/connections': () => import('../../../app/routes/api/v1/users/connections/_connections'),
  'v1/users/follow': () => import('../../../app/routes/api/v1/users/follow/_follow'),
  'v1/users/friend': () => import('../../../app/routes/api/v1/users/friend/_friend'),
  'v1/users/profile': () => import('../../../app/routes/api/v1/users/profile/_profile'),
  'v1/users/relationships': () => import('../../../app/routes/api/v1/users/relationships/_relationships'),
  'v1/users/search': () => import('../../../app/routes/api/v1/users/search/_search'),
  'v1/vercel/deployments': () => import('../../../app/routes/api/v1/vercel/deployments/_deployments'),
  'v1/vercel/status': () => import('../../../app/routes/api/v1/vercel/status/_status'),
  'v1/vercel/status-data': () => import('../../../app/routes/api/v1/vercel/status-data/_status-data'),
  'v1/vercel/webhook': () => import('../../../app/routes/api/v1/vercel/webhook/_webhook'),
  'v1/waitlist': () => import('../../../app/routes/api/v1/waitlist/_waitlist')
};

const normalizePath = (value: unknown, url?: string) => {
  if (Array.isArray(value) && value.length) return value.join('/');

  const fromParams = String(value || '').replace(/^\/+|\/+$/g, '');
  if (fromParams) return fromParams;

  const pathname = new URL(url || '/', 'http://localhost').pathname;
  return pathname.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');
};

const jsonResponse = (value: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  return new Response(JSON.stringify(value), {
    ...init,
    headers
  });
};

const normalizeResponse = (value: unknown) => {
  if (value instanceof Response) {
    return value;
  }

  if (value && typeof value === 'object' && 'body' in value && ('status' in value || 'headers' in value)) {
    const legacy = value as {
      status?: number;
      headers?: HeadersInit;
      body?: unknown;
    };

    return new Response(JSON.stringify(legacy.body ?? null), {
      status: legacy.status || 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(legacy.headers as Record<string, string> | undefined)
      }
    });
  }

  return jsonResponse(value ?? null);
};

export default defineHandler(async (event) => {
  const path = normalizePath(event.context.params?.path, event.req.url);
  const method = event.req.method.toUpperCase();

  if (path.endsWith('-docs')) {
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, POST' }
      });
    }

    // 🔮 the teapot's -docs twin is real but unlisted (claude-todo/10):
    // it never appears in /docs/api, yet the self-describing convention holds
    if (path === 'v1/teapot-docs') {
      return jsonResponse({
        ok: true,
        endpoint: '/api/v1/teapot',
        methods: ['GET', 'POST'],
        summary: 'Politely declines to brew coffee.',
        detail:
          'RFC 2324 lives here. Every documented endpoint serves JSON docs at -docs — including the ones you were never told about. Congratulations on your curiosity. 🫖',
        responses: [{ status: 418, description: 'Short and stout, with a brew-time haiku.' }]
      });
    }

    // lazy: apiDocs is ~150KB of doc-string literals — parsing it belongs to
    // the rare -docs request, not to every instance's cold start
    const { createApiDocPayload, getApiDocByPath } = await import('../../../app/docs/apiDocs');
    const doc = getApiDocByPath(path);
    if (!doc) {
      return jsonResponse({ ok: false, error: 'API docs not found' }, { status: 404 });
    }

    return jsonResponse(createApiDocPayload(doc, new URL(event.req.url).origin));
  }

  if (shouldProxyApiToFallback(event.req)) {
    return proxyApiRequestToFallback(event.req);
  }

	if (path === 'v1/capabilities') {
		const { createApiCapabilitiesManifest } = await import('../../../app/docs/apiDocs');
		const { getDeploymentDataEnvironment } = await import('../../../app/api/utils/deployment/dataEnvironment');
		return jsonResponse(createApiCapabilitiesManifest([...Object.keys(routeModules), 'v1/capabilities'], getDeploymentDataEnvironment()), {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' }
    });
  }

  const loadModule = routeModules[path];

  if (!loadModule) {
    // 🔮 even the 404 speaks Lopu (claude-todo/10) — same {ok, error} envelope
    // as every other API response instead of a bare text body
    return jsonResponse({ ok: false, error: 'Lopu looked everywhere and found no such endpoint 🤷‍♂️' }, { status: 404 });
  }

  const route = await loadModule();
  const handler = method === 'GET' || method === 'HEAD' ? route.loader : route.action;

  if (!handler) {
    return new Response('Method not allowed', {
      status: 405,
      headers: {
        Allow: [route.loader ? 'GET' : undefined, route.action ? 'POST' : undefined].filter(Boolean).join(', ')
      }
    });
  }

  // Establish the request's MongoDB endpoint context (the `tt_mongo` session
  // cookie / `x-tt-mongo-url` header — see api/utils/mongodb/endpoint.ts) so
  // the data plane below the handler resolves the session's active endpoint.
  // Admin routes are exempt: migrations and other admin writes must always
  // operate on the home deployment, never on an override DB.
  const mongoEndpoint = path.startsWith('v1/admin/') ? null : await getRequestMongoEndpoint(event.req);

  try {
		return await runWithMongoEndpoint(mongoEndpoint, async () => normalizeResponse(await handler({ request: event.req })));
  } catch (err) {
    if (err instanceof Response) {
      return err;
    }
		if (err instanceof StorageMutationError) {
			return jsonResponse({ ok: false, error: err.message }, { status: err.status });
		}

    throw err;
  }
});
