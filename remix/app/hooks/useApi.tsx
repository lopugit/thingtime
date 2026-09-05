import { useCallback } from 'react';

import { buildActionRunBody } from '~/components/Actions/actionRunRequest';
import { flushAttachmentDraftCleanups } from '~/components/Attachments/attachmentDraftCleanup';
import type { AttachmentUploadPurpose } from '~/components/Attachments/attachmentTypes';
import { postLopuReply, type LopuReplyBody } from '~/components/Lopu/lopuChatStream';
import { recordApiCall } from './apiRequestLog';
import { useAsyncFetcher } from './useAsyncFetcher';
import { clearLocalCachePrefix } from './localCache';
import { createApiFailure, readApiResponsePayload } from './apiFailure';
import { buildThingCommentRequestPayload, buildThingCreateRequestPayload } from './thingsRequestPayload';

const refreshRootData = () => {
  window.dispatchEvent(new Event('thingtime:root-data-refresh'));
};

// GET helper mirroring useAsyncFetcher semantics: parses JSON and throws the
// parsed payload on !ok so callers catch { ok: false, error } shapes.
// Every call is recorded in the DevKit request log (method/path/status/ms).
const getJson = async (url: string, options?: { signal?: AbortSignal }) => {
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include', signal: options?.signal });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    recordApiCall({
      at: Date.now(),
      method: 'GET',
      url,
      status: 0,
      ok: false,
      aborted,
      durationMs: Math.round(performance.now() - started)
    });
    if (aborted) throw error;
    throw createApiFailure({ cause: error, action: 'load Thingtime data', method: 'GET' });
  }
  recordApiCall({
    at: Date.now(),
    method: 'GET',
    url,
    status: response.status,
    ok: response.ok,
    durationMs: Math.round(performance.now() - started)
  });
  const data = await readApiResponsePayload(response, { action: 'load Thingtime data', method: 'GET' });
  if (!response.ok) {
    throw createApiFailure({
      payload: data,
      status: response.status,
      retryAfter: response.headers.get('Retry-After'),
      action: 'load Thingtime data',
      method: 'GET'
    });
  }
  return data;
};

// Build "?a=1&b=2" from an args object, skipping null/undefined/'' and
// joining array values with commas (the feed API's csv convention).
const toQuery = (args?: Record<string, unknown>) => {
  const params = new URLSearchParams();
  Object.entries(args || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    const str = Array.isArray(value) ? value.join(',') : String(value);
    if (str) params.set(key, str);
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

export function useApi() {
  const asyncFetcher = useAsyncFetcher();

  const v1 = {
    login: useCallback(
      async (args) => {
        const { username, password, challenge, code } = args;

        // two-step email 2FA: the second call swaps the emailed code for the
        // session the password step withheld
        const body = challenge ? { challenge, code } : { username, password };
        const ret = asyncFetcher.submit(body, { action: '/api/v1/login' });
        ret.then(refreshRootData).catch(() => {});
        return ret;
      },
      [asyncFetcher]
    ),
    auth: {
      register: useCallback(
        async (args) => {
          const { username, password, email, displayName } = args;
          const ret = asyncFetcher.submit({ username, password, email, displayName }, { action: '/api/v1/auth/register' });
          ret.then(refreshRootData).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      ),
      resendVerification: useCallback(
        async (args) => {
          const { email } = args;
          const ret = asyncFetcher.submit({ email }, { action: '/api/v1/auth/resend-verification' });
          ret.then(refreshRootData).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      ),
      passwordReset: {
        // neutral response by design — never confirms the account exists
        request: useCallback(async (args) => asyncFetcher.submit({ email: args?.email }, { action: '/api/v1/auth/password-reset' }), [asyncFetcher]),
        confirm: useCallback(
          async (args) => asyncFetcher.submit({ token: args?.token, password: args?.password }, { action: '/api/v1/auth/password-reset/confirm' }),
          [asyncFetcher]
        )
      },
      twoFactor: {
        get: useCallback(async () => getJson('/api/v1/auth/two-factor'), []),
        set: useCallback(async (args) => asyncFetcher.submit({ enabled: !!args?.enabled }, { action: '/api/v1/auth/two-factor' }), [asyncFetcher])
      },
      logout: useCallback(
        async (args?: { all?: boolean }) => {
					await flushAttachmentDraftCleanups();
          // owner-tier activity day-counts must not outlive the session that
          // authorized them (shared-browser privacy) — unlike viewer-neutral
          // tt-* caches (theme vars, emoji recents), which persist by design
          clearLocalCachePrefix('tt-activity-');
          // quick-switcher recents can name the viewer's private things —
          // same shared-browser privacy bar as the activity counts
          clearLocalCachePrefix('tt-quickswitch-');
          // same shared-browser rule for "On this day" memories — cached tiles
          // can carry private/circle post snippets for the signed-out viewer
          clearLocalCachePrefix('tt-onthisday-');
          // the Saved library cache can carry private/circle posts the
          // signed-out viewer bookmarked — same shared-browser privacy bar
          clearLocalCachePrefix('tt-saved-');
          // builder-page source results are whole action results run AS the
          // viewer (their orders, their expense rows, their trainer) cached to
          // paint /p/<page> without a spinner — the same shared-browser rule.
          // The keys carry the viewer id, so a stale line can no longer be
          // READ by the next account; dropping them here also stops it
          // outliving the session that authorized it on disk.
          clearLocalCachePrefix('tt-page-source:');
          // Lopu's caches (conversations, messages, model catalog, the
          // floating window's last state) are the viewer's private chat
          // with the assistant — same shared-browser privacy bar.
          clearLocalCachePrefix('tt-lopu-');
          clearLocalCachePrefix('tt-passkeys');
          // Notification history can include private posts and action runs.
          clearLocalCachePrefix('tt-notif-history-');
          const ret = asyncFetcher.submit(args?.all ? { all: true } : {}, { action: '/api/v1/auth/logout' });
          ret.then(refreshRootData).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      ),
      accounts: {
        // Listing changes no state, so no refreshRootData (pruning only rewrites
        // the roster cookie, never the active user).
        list: useCallback(async () => getJson('/api/v1/auth/accounts'), []),
        switch: useCallback(
          async (args) => {
						await flushAttachmentDraftCleanups();
            const ret = asyncFetcher.submit({ userId: args?.userId }, { action: '/api/v1/auth/accounts/switch' });
            ret.then(refreshRootData).catch(() => {});
            return ret;
          },
          [asyncFetcher]
        ),
        remove: useCallback(
          async (args) => {
            const ret = asyncFetcher.submit({ userId: args?.userId }, { action: '/api/v1/auth/accounts/remove' });
            ret.then(refreshRootData).catch(() => {});
            return ret;
          },
          [asyncFetcher]
        ),
        owned: useCallback(async () => getJson('/api/v1/auth/accounts/owned'), []),
        assume: useCallback(
          async (args: { accountId: string }) => {
						await flushAttachmentDraftCleanups();
            const ret = asyncFetcher.submit({ accountId: args?.accountId }, { action: '/api/v1/auth/accounts/assume' });
            ret.then(refreshRootData).catch(() => {});
            return ret;
          },
          [asyncFetcher]
        )
      },
      // Accounts this browser is signed into on OTHER Thingtime deployments
      // (cross-deployment auto-login suggestions). Read-only.
      accountHints: useCallback(async () => getJson('/api/v1/auth/account-hints'), []),
      // Cross-origin session handoff (Login with Thingtime anywhere): mint a
      // code for a target origin / redeem one minted for THIS origin.
      ssoHandoff: useCallback(
        async (args: { origin: string }) => asyncFetcher.submit({ origin: args?.origin }, { action: '/api/v1/auth/sso-handoff' }),
        [asyncFetcher]
      ),
      ssoSession: useCallback(
        async (args: { code: string }) => {
          const ret = asyncFetcher.submit({ code: args?.code }, { action: '/api/v1/auth/sso-session' });
          ret.then(refreshRootData).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      ),
      passkeys: {
        list: useCallback(async () => getJson('/api/v1/auth/passkeys'), []),
        registerOptions: useCallback(
          async (args: { password: string; signal?: AbortSignal }) => asyncFetcher.submit({ password: args?.password }, { action: '/api/v1/auth/passkeys/register-options', signal: args.signal }),
          [asyncFetcher]
        ),
        register: useCallback(
          async (args: { response: unknown; nickname?: string; description?: string; signal?: AbortSignal }) =>
            asyncFetcher.submit(
              { response: args?.response, nickname: args?.nickname, description: args?.description },
              { action: '/api/v1/auth/passkeys/register', signal: args.signal }
            ),
          [asyncFetcher]
        ),
        loginOptions: useCallback(async (args?: { signal?: AbortSignal }) => asyncFetcher.submit({}, { action: '/api/v1/auth/passkeys/login-options', signal: args?.signal }), [asyncFetcher]),
        // Finishing a passkey login changes the active user — refresh root data
        // exactly like password login does.
        login: useCallback(
          async (args: { response: unknown; clientId?: string; signal?: AbortSignal }) => {
            const ret = asyncFetcher.submit(
              { response: args?.response, ...(args?.clientId ? { clientId: args.clientId } : {}) },
              { action: '/api/v1/auth/passkeys/login', signal: args.signal }
            );
            ret.then(refreshRootData).catch(() => {});
            return ret;
          },
          [asyncFetcher]
        ),
        update: useCallback(
          async (args: { id: string; nickname?: string; description?: string }) =>
            asyncFetcher.submit(
              { id: args?.id, ...(args?.nickname !== undefined ? { nickname: args.nickname } : {}), ...(args?.description !== undefined ? { description: args.description } : {}) },
              { action: '/api/v1/auth/passkeys/update' }
            ),
          [asyncFetcher]
        ),
        revoke: useCallback(
          async (args: { id: string; password: string }) =>
            asyncFetcher.submit({ id: args?.id, password: args?.password }, { action: '/api/v1/auth/passkeys/revoke' }),
          [asyncFetcher]
        ),
        delete: useCallback(
          async (args: { id: string; password: string }) =>
            asyncFetcher.submit({ id: args?.id, password: args?.password }, { action: '/api/v1/auth/passkeys/delete' }),
          [asyncFetcher]
        )
      }
    },
    settings: {
      // Public so the GitHub conflict resolver can read the same ordered model
      // waterfall as the admin UI without inheriting an admin browser session.
			prConflictResolverModelWaterfall: useCallback(async () => getJson('/api/v1/settings/pr-conflict-auto-resolver-model-waterfall'), []),
			// Lopu's stored chat defaults ({ model, effort, speed }); public GET, admin POST (admin.setLopuChatDefaults)
			lopuChatDefaults: useCallback(async () => getJson('/api/v1/settings/lopu-chat-defaults'), [])
    },
    // the `ai-model` catalog Lopu thinks with (public; { models, defaults, providers }
    // + for a signed-in viewer their Secure Vault providers as metadata only:
    // vaultProviders: [{ id, name, kind, model, endpointHost, available, reason? }], vault: { configured })
    ai: {
      models: useCallback(async () => getJson('/api/v1/ai/models'), [])
    },
    admin: {
      // { id, enabled } toggles one catalog model; { seed: true } re-runs the catalog upsert;
      // { probe: true } re-checks the provider keys (fresh providers.<p>.verified + the re-projected list)
      setAiModel: useCallback(
        async (args: { id?: string; enabled?: boolean; seed?: boolean; probe?: boolean }) =>
          asyncFetcher.submit(args, { action: '/api/v1/admin/ai/models', errorContext: 'update the Lopu model catalog' }),
        [asyncFetcher]
      ),
      setLopuChatDefaults: useCallback(
        async (args: { model?: string | null; effort?: string | null; speed?: string | null }) =>
          asyncFetcher.submit(
            { model: args?.model ?? null, effort: args?.effort ?? null, speed: args?.speed ?? null },
            { action: '/api/v1/settings/lopu-chat-defaults', errorContext: 'save the Lopu chat defaults' }
          ),
        [asyncFetcher]
      ),
      integrations: useCallback(async () => getJson('/api/v1/admin/integrations'), []),
      integrationAction: useCallback(
        async (args: Record<string, unknown>) =>
          asyncFetcher.submit(args, { action: '/api/v1/admin/integrations', errorContext: 'manage integration policy' }),
        [asyncFetcher]
      ),
      ciControl: useCallback(
				async (args?: { limit?: number }, options?: { signal?: AbortSignal }) => getJson(`/api/v1/admin/ci${toQuery(args)}`, options),
        []
      ),
      ciCredentials: useCallback(async (options?: { signal?: AbortSignal }) => getJson('/api/v1/admin/ci/credentials', options), []),
      ciFeatureStacks: useCallback(async (options?: { signal?: AbortSignal }) => getJson('/api/v1/admin/ci/stacks', options), []),
      mutateCiFeatureStack: useCallback(
        async (args: Record<string, unknown>) =>
          asyncFetcher.submit(args, { action: '/api/v1/admin/ci/stacks', errorContext: 'manage Feature Stacks' }),
        [asyncFetcher]
      ),
      mutateCiCredential: useCallback(
        async (args: Record<string, unknown>) =>
          asyncFetcher.submit(args, { action: '/api/v1/admin/ci/credentials', errorContext: 'manage Lopu credential waterfall' }),
        [asyncFetcher]
      ),
      reconcileCiControl: useCallback(
        async () => asyncFetcher.submit({}, { action: '/api/v1/admin/ci/reconcile', errorContext: 'reconcile CI control data' }),
        [asyncFetcher]
      ),
      dispatchCiWorkflow: useCallback(
        async (args: { workflow: string; ref?: string; inputs?: Record<string, unknown> }) =>
          asyncFetcher.submit(args, { action: '/api/v1/admin/ci/dispatch', errorContext: `dispatch ${args.workflow}` }),
        [asyncFetcher]
      ),
      setCiAutomationPolicy: useCallback(
        async (args: { workflow: string; executionProvider: string; enabled?: boolean }) =>
          asyncFetcher.submit(args, { action: '/api/v1/admin/ci/automations', errorContext: `update ${args.workflow} execution provider` }),
        [asyncFetcher]
      ),
      setCiPreviewPolicy: useCallback(
        async (args: { prNumber: number; environment: 'develop' | 'production'; enabled: boolean; acknowledgeProductionData?: boolean }) =>
          asyncFetcher.submit(args, { action: '/api/v1/admin/ci/previews', errorContext: `update ${args.environment} PR preview` }),
        [asyncFetcher]
      ),
      setPrConflictResolverModelWaterfall: useCallback(
				async (waterfall) => asyncFetcher.submit({ waterfall }, { action: '/api/v1/settings/pr-conflict-auto-resolver-model-waterfall' }),
        [asyncFetcher]
      ),
      rateLimits: useCallback(async () => getJson('/api/v1/admin/rate-limits'), []),
      setRateLimits: useCallback(async (endpoints) => asyncFetcher.submit({ endpoints }, { action: '/api/v1/admin/rate-limits' }), [asyncFetcher]),
			// A private, cursor-paged projection for the Developer → Deployment
			// peers explorer. This intentionally differs from /api/v1/peers,
			// whose HMAC + Ed25519 protocol is for deployments only.
			peers: useCallback(
				async (args?: { cursor?: string; limit?: number }, options?: { signal?: AbortSignal }) =>
					getJson(`/api/v1/admin/peers${toQuery(args)}`, options),
				[]
			),
      users: useCallback(async (args) => getJson(`/api/v1/admin/users${toQuery(args)}`), []),
      setAdmin: useCallback(
        async (args) => asyncFetcher.submit({ userId: args?.userId, admin: args?.admin }, { action: '/api/v1/admin/set-admin' }),
        [asyncFetcher]
      ),
      setUserPublicUploads: useCallback(
        async (args: { userId: string; enabled: boolean; scope?: 'public' | 'private' | 'all' }) =>
          asyncFetcher.submit(
            { userId: args?.userId, enabled: args?.enabled, scope: args?.scope ?? 'public' },
            {
              action: '/api/v1/admin/users/public-uploads',
              errorContext: `${args?.enabled ? 'approve' : 'withhold'} ${args?.scope ?? 'public'} uploads`
            }
          ),
        [asyncFetcher]
      ),
      moderation: useCallback(async () => getJson('/api/v1/admin/moderation'), []),
      moderationReview: useCallback(
        async (args) =>
          asyncFetcher.submit(
            { action: 'review', attachmentId: args?.attachmentId, verdict: args?.verdict, targetKind: args?.targetKind },
            { action: '/api/v1/admin/moderation' }
          ),
        [asyncFetcher]
      ),
      moderationSweep: useCallback(async () => asyncFetcher.submit({ action: 'sweep' }, { action: '/api/v1/admin/moderation' }), [asyncFetcher]),
      moderationSettings: useCallback(
        async (args) => asyncFetcher.submit({ action: 'settings', settings: args?.settings }, { action: '/api/v1/admin/moderation' }),
        [asyncFetcher]
      ),
      migrations: useCallback(async () => getJson('/api/v1/admin/migrations'), []),
			migrationDiagnostic: useCallback(
				async (args, options?: { signal?: AbortSignal }) => getJson(`/api/v1/admin/migrations/diagnostic${toQuery({ id: args?.id })}`, options),
				[]
			),
      migrationsRun: useCallback(
        async (args) =>
          asyncFetcher.submit(
            { migration: args?.migration, dryRun: args?.dryRun, confirm: args?.confirm },
            {
              action: '/api/v1/admin/migrations/run',
              errorContext: args?.dryRun ? `preview migration ${args?.migration}` : `run migration ${args?.migration}`
            }
          ),
        [asyncFetcher]
      ),
      usersOverview: useCallback(
        async (args?: { q?: string; limit?: number; cursor?: string }, options?: { signal?: AbortSignal }) =>
          getJson(`/api/v1/admin/users/overview${toQuery(args)}`, options),
        []
      ),
      apps: useCallback(
        async (args?: { q?: string; limit?: number; cursor?: string }, options?: { signal?: AbortSignal }) =>
          getJson(`/api/v1/admin/apps${toQuery(args)}`, options),
        []
      ),
      revokeApp: useCallback(
        async (args: { clientId: string; revoked: boolean }) =>
          asyncFetcher.submit({ clientId: args?.clientId, revoked: args?.revoked }, { action: '/api/v1/admin/apps/revoke' }),
        [asyncFetcher]
      ),
      subscription: useCallback(
        async (args: { subjectType: 'user' | 'app'; subjectId: string }) => getJson(`/api/v1/admin/subscriptions${toQuery(args)}`),
        []
      ),
      setSubscription: useCallback(
        async (args: {
          subjectType: 'user' | 'app';
          subjectId: string;
          tier?: string;
          tierVersionId?: string;
          overrides?: Record<string, number | null> | null;
          note?: string;
          clear?: boolean;
        }) => asyncFetcher.submit(args, { action: '/api/v1/admin/subscriptions' }),
        [asyncFetcher]
      ),
      tiers: useCallback(async () => getJson('/api/v1/admin/tiers'), []),
      setTier: useCallback(
        async (args: {
          action: 'create' | 'update-draft' | 'create-version' | 'publish' | 'archive';
          versionId?: string;
          tier?: Record<string, unknown>;
        }) => asyncFetcher.submit(args, { action: '/api/v1/admin/tiers' }),
        [asyncFetcher]
      ),
      links: useCallback(
        async (args: { userId?: string; targetId?: string; linkKind?: 'account' | 'app' }) => getJson(`/api/v1/admin/links${toQuery(args)}`),
        []
      ),
      setLink: useCallback(
        async (args: { action: 'add' | 'remove'; linkKind: 'account' | 'app'; userId: string; targetId: string }) =>
          asyncFetcher.submit(args, { action: '/api/v1/admin/links' }),
        [asyncFetcher]
      )
    },
    // Lopu 🦄 conversations (session only) — see /docs/api lopu. The model
    // catalog is v1.ai.models() above.
    lopu: {
      chats: {
        list: useCallback(async (options?: { signal?: AbortSignal }) => getJson('/api/v1/lopu/chats', options), []),
        // providerId = one of the viewer's Secure Vault providers (v1.ai.models()
        // → vaultProviders[].id); null clears it back to the catalog model
        create: useCallback(
          async (args?: { title?: string; model?: string; effort?: string; speed?: string; providerId?: string | null }) =>
            asyncFetcher.submit(args || {}, { action: '/api/v1/lopu/chats', errorContext: 'start a Lopu chat' }),
          [asyncFetcher]
        ),
        update: useCallback(
          async (args: { chatId: string; title?: string; model?: string; effort?: string; speed?: string; providerId?: string | null }) =>
            asyncFetcher.submit(args, { action: '/api/v1/lopu/chats/update', errorContext: 'update a Lopu chat' }),
          [asyncFetcher]
        ),
        delete: useCallback(
          async (args: { chatId: string }) =>
            asyncFetcher.submit({ chatId: args?.chatId }, { action: '/api/v1/lopu/chats/delete', errorContext: 'delete a Lopu chat' }),
          [asyncFetcher]
        )
      },
      // the streamed turn — returns the RAW Response (NDJSON body); read it
      // with readNdjson from components/Lopu/lopuChatStream
      reply: useCallback(async (body: LopuReplyBody, options?: { signal?: AbortSignal }) => postLopuReply(body, options), []),
      // direct voice (design note §6.1): the provider-minted five-minute
      // realtime credential for one of the viewer's own Secure Vault
      // providers (v1.ai.models() → vaultProviders[].realtimeModels); a
      // refusal throws the route's error shape (400 with the reason)
      voiceSession: useCallback(
        async (args: { providerId: string; model?: string | null; effort?: string | null; textResponse?: boolean }, options?: { signal?: AbortSignal }) =>
          asyncFetcher.submit(args, { action: '/api/v1/lopu/voice/session', errorContext: 'start direct voice', signal: options?.signal }),
        [asyncFetcher]
      )
    },
    mongodb: {
      capabilities: useCallback(async () => getJson('/api/v1/mongodb/raw-results'), []),
      rawResults: useCallback(
        async (args, options?: { signal?: AbortSignal }) =>
          asyncFetcher.submit(args, { action: '/api/v1/mongodb/raw-results', signal: options?.signal }),
        [asyncFetcher]
      ),
      // session data-endpoint override (thin-frontend mode): which MongoDB the
      // data plane uses for this browser session
      endpoint: {
        get: useCallback(async () => getJson('/api/v1/mongodb/endpoint'), []),
        set: useCallback(
          async (args?: { url?: string; savedId?: string; reset?: boolean }) => {
            const body = args?.savedId ? { savedId: args.savedId } : args?.reset ? { reset: true } : { url: args?.url };
            const ret = asyncFetcher.submit(body, { action: '/api/v1/mongodb/endpoint' });
            // the data plane just moved — cached feeds/lists are stale, so
            // refresh root data the same way login/logout do
            ret.then(refreshRootData).catch(() => {});
            return ret;
          },
          [asyncFetcher]
        )
      },
      // the signed-in user's saved endpoints (persisted server-side)
      endpoints: {
        list: useCallback(async () => getJson('/api/v1/mongodb/endpoints'), []),
        add: useCallback(
          async (args?: { name?: string; url?: string }) =>
            asyncFetcher.submit({ name: args?.name, url: args?.url }, { action: '/api/v1/mongodb/endpoints' }),
          [asyncFetcher]
        ),
        remove: useCallback(
          async (args?: { id?: string }) => {
            const ret = asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/mongodb/endpoints', method: 'DELETE' });
            // removing the session's active endpoint clears the override
            ret.then(refreshRootData).catch(() => {});
            return ret;
          },
          [asyncFetcher]
        )
      }
    },
    // cross-deployment account links (Settings → Linked deployments)
    deploymentLinks: {
      list: useCallback(async () => getJson('/api/v1/deployment-links'), []),
      link: useCallback(
        async (args?: {
          baseUrl?: string;
          name?: string;
          token?: string;
          username?: string;
          password?: string;
          challenge?: string;
          code?: string;
        }) => asyncFetcher.submit(args || {}, { action: '/api/v1/deployment-links' }),
        [asyncFetcher]
      ),
      update: useCallback(
        async (args?: { id?: string; name?: string; syncMode?: string; pathRules?: unknown }) =>
          asyncFetcher.submit(args || {}, { action: '/api/v1/deployment-links', method: 'PATCH' }),
        [asyncFetcher]
      ),
      remove: useCallback(
        async (args?: { id?: string }) =>
          asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/deployment-links', method: 'DELETE' }),
        [asyncFetcher]
      ),
      sync: useCallback(
        async (args?: { id?: string; dryRun?: boolean }) => {
          const ret = asyncFetcher.submit(args || {}, { action: '/api/v1/deployment-links/sync' });
          // a pull may have rewritten local things — refresh like login does
          ret.then((result: any) => {
            if (result?.report && !result.report.dryRun && result.report.pulled > 0) refreshRootData();
          }).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      ),
      mintToken: useCallback(
        async () => asyncFetcher.submit({}, { action: '/api/v1/deployment-links/token' }),
        [asyncFetcher]
      )
    },
		attachments: {
			uploads: {
				create: useCallback(
					async (
						args: {
							requestId: string;
							filename: string;
							contentType: string;
							sizeBytes: number;
							purpose?: AttachmentUploadPurpose;
						},
						options?: { signal?: AbortSignal }
					) => {
						const ret = asyncFetcher.submit(
							{
								requestId: args?.requestId,
								filename: args?.filename,
								contentType: args?.contentType,
								sizeBytes: args?.sizeBytes,
								...(args?.purpose ? { purpose: args.purpose } : {})
							},
							{
								action: '/api/v1/attachments/uploads',
								signal: options?.signal,
								errorContext: 'prepare a file upload'
							}
						);
						ret.then(refreshRootData).catch(() => {});
						return ret;
					},
					[asyncFetcher]
				),
				parts: useCallback(
					async (args: { uploadId: string; parts: Array<{ partNumber: number; checksumSha256: string }> }, options?: { signal?: AbortSignal }) =>
						asyncFetcher.submit(
							{ uploadId: args?.uploadId, parts: args?.parts },
							{
								action: '/api/v1/attachments/uploads/parts',
								signal: options?.signal,
								errorContext: 'prepare file upload parts'
							}
						),
					[asyncFetcher]
				),
				complete: useCallback(
					async (args: { uploadId: string }, options?: { signal?: AbortSignal }) => {
						const ret = asyncFetcher.submit(
							{ uploadId: args?.uploadId },
							{
								action: '/api/v1/attachments/uploads/complete',
								signal: options?.signal,
								errorContext: 'verify a file upload'
							}
						);
						ret.then(refreshRootData).catch(() => {});
						return ret;
					},
					[asyncFetcher]
				),
				abort: useCallback(
					async (args: { uploadId: string }, options?: { signal?: AbortSignal }) => {
						const ret = asyncFetcher.submit(
							{ uploadId: args?.uploadId },
							{
								action: '/api/v1/attachments/uploads/abort',
								signal: options?.signal,
								errorContext: 'cancel a file upload'
							}
						);
						ret.then(refreshRootData).catch(() => {});
						return ret;
					},
					[asyncFetcher]
				)
			},
			remove: useCallback(
				async (args: { id: string; targetId?: string }) => {
					const ret = asyncFetcher.submit(
						{ id: args?.id, ...(args.targetId ? { targetId: args.targetId } : {}) },
						{ action: '/api/v1/attachments/delete', errorContext: args.targetId ? 'delete an attached file' : 'remove a draft file' }
					);
					ret.then(refreshRootData).catch(() => {});
					return ret;
				},
				[asyncFetcher]
			),
			// mint a READY linked-attachment draft from an external media URL — it
			// binds/orders/deletes like an upload but its bytes stay on the original
			// site (duplicates allowed; unbound mints expire in 24h)
			link: useCallback(
				async (args: { url: string; purpose?: 'post' | 'comment'; mediaKind?: 'image' | 'video' | 'file' }, options?: { signal?: AbortSignal }) => {
					const ret = asyncFetcher.submit(
						{
							url: args?.url,
							...(args?.purpose && args.purpose !== 'post' ? { purpose: args.purpose } : {}),
							...(args?.mediaKind ? { mediaKind: args.mediaKind } : {})
						},
						{ action: '/api/v1/attachments/link', errorContext: 'add linked media', signal: options?.signal }
					);
					ret.then(refreshRootData).catch(() => {});
					return ret;
				},
				[asyncFetcher]
			),
			// owner display metadata on a ready attachment (media page + lightbox
			// text) — omit a field to keep it, null/'' clears it
			annotate: useCallback(
				async (args: { id: string; filenamePreview?: string | null; title?: string | null; description?: string | null }) =>
					asyncFetcher.submit(
						{
							id: args?.id,
							...(args && 'filenamePreview' in args ? { filenamePreview: args.filenamePreview } : {}),
							...(args && 'title' in args ? { title: args.title } : {}),
							...(args && 'description' in args ? { description: args.description } : {})
						},
						{ action: '/api/v1/attachments/annotate', errorContext: 'save media details' }
					),
				[asyncFetcher]
			)
		},
    things: {
      feed: useCallback(async (args) => getJson(`/api/v1/things/feed${toQuery(args)}`), []),
      // the explore board — public trending posts; `anon: 1` keeps logged-out
      // requests edge-cacheable, mirroring feed
      trending: useCallback(async (args?: { anon?: 1 }) => getJson(`/api/v1/things/trending${toQuery(args)}`), []),
			reveal: useCallback(
				async (args: { thingId: string; reference: string; password: string }, options?: { signal?: AbortSignal }) =>
					asyncFetcher.submit(
						{ thingId: args?.thingId, reference: args?.reference, password: args?.password },
						{ action: '/api/v1/things/reveal', signal: options?.signal, errorContext: 'reveal a protected value' }
					),
				[asyncFetcher]
			),
      // structured search — POST carries the condition tree (read-only despite
      // the verb); see /docs/api things-search. Anonymous simple searches
      // (anon flag set, no condition tree) go over the GET form instead so
      // Vercel's edge can cache the logged-out view (`anon=1` responses depend
      // only on the URL). `mode` is meaningless without conditions, so the GET
      // URL drops it to keep cache keys stable.
      search: useCallback(
        async (args) => {
          const { conditions, mode, ...rest } = args || {};
          if (rest.anon && !conditions) {
            return getJson(`/api/v1/things/search${toQuery(rest)}`);
          }
          return asyncFetcher.submit(args || {}, { action: '/api/v1/things/search' });
        },
        [asyncFetcher]
      ),
      userPosts: useCallback(async (args) => getJson(`/api/v1/things/user${toQuery(args)}`), []),
			get: useCallback(async (args, options?: { signal?: AbortSignal }) => getJson(`/api/v1/things${toQuery({ id: args?.id })}`, options), []),
      list: useCallback(
        async (args) =>
          getJson(
            `/api/v1/things${toQuery({
              target: args?.target,
              thingtime: args?.thingtime,
              folder: args?.folder,
              cursor: args?.cursor,
              limit: args?.limit,
              // session-auth data browser: narrow own-things to ONE app's namespace
              appId: args?.appId
            })}`
          ),
        []
      ),
      update: useCallback(
        async (args) =>
          asyncFetcher.submit(
            {
              id: args?.id,
              crystal: args?.crystal,
              acl: args?.acl,
              visibility: args?.visibility,
              tags: args?.tags,
              tokenAcl: args?.tokenAcl,
              // move support — only send folderId when the caller provides it
              // (undefined must stay "leave it where it is", null = root)
              ...(args && 'folderId' in args ? { folderId: args.folderId } : {}),
              // attachment sync — only send when the caller provides it (the
              // full desired order: every bound id plus any newly uploaded
              // ready drafts to bind; removals are rejected server-side)
              ...(args && 'attachmentIds' in args ? { attachmentIds: args.attachmentIds } : {})
            },
            { action: '/api/v1/things', method: 'PATCH' }
          ),
        [asyncFetcher]
      ),
      // multi-select move/copy/delete/share — see /docs/api things-bulk
      bulk: useCallback(
        async (args) =>
          asyncFetcher.submit(
            {
              op: args?.op,
              ids: args?.ids,
              folderId: args?.folderId ?? null,
              // share op only — omitted entirely for move/copy/delete
              ...(args && 'acl' in args ? { acl: args.acl } : {}),
              ...(args?.recursive ? { recursive: true } : {})
            },
            { action: '/api/v1/things/bulk' }
          ),
        [asyncFetcher]
      ),
      upsert: useCallback(
        async (args) =>
          asyncFetcher.submit(
            {
              id: args?.id,
              thingtime: args?.thingtime,
              crystal: args?.crystal,
              acl: args?.acl,
              visibility: args?.visibility,
              targetId: args?.targetId,
              tags: args?.tags,
              tokenAcl: args?.tokenAcl
            },
            { action: '/api/v1/things', method: 'PUT' }
          ),
        [asyncFetcher]
      ),
      reactionsRecent: useCallback(async () => getJson('/api/v1/things/reactions-recent'), []),
      create: useCallback(
        async (args) => {
					const payload = buildThingCreateRequestPayload(args);
					const attachmentIds = args?.attachmentIds;
					const ret = asyncFetcher.submit(payload, { action: '/api/v1/things' });
					if (Array.isArray(attachmentIds) && attachmentIds.length > 0) {
						ret.then(refreshRootData).catch(() => {});
					}
					return ret;
        },
        [asyncFetcher]
      ),
      react: useCallback(
        async (args) =>
					asyncFetcher.submit({ id: args?.id, emoji: args?.emoji ?? null }, { action: '/api/v1/things/react', errorContext: 'save your reaction' }),
        [asyncFetcher]
      ),
      // toggle a private "add to my library" save on any visible thing
      save: useCallback(async (args) => asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/things/save' }), [asyncFetcher]),
      // the viewer's Saved library — posts they bookmarked, newest-saved-first
      saved: useCallback(async (args?: { cursor?: string; limit?: number }) => getJson(`/api/v1/things/saved${toQuery(args)}`), []),
      // cast/move/remove the caller's vote on a visible poll thing
      vote: useCallback(
        async (args: { id: string; optionIndex: number }) =>
          asyncFetcher.submit({ id: args?.id, optionIndex: args?.optionIndex }, { action: '/api/v1/things/vote', errorContext: 'save your vote' }),
        [asyncFetcher]
      ),
      comment: useCallback(
        // simple text comments send { id, text }; rich comments add
				// type/images/listing/thing/mediaLayout/tags/attachments — comments share the post schema
        async (args) => {
					const attachmentIds = args?.attachmentIds;
					const ret = asyncFetcher.submit(
						buildThingCommentRequestPayload(args),
						{ action: '/api/v1/things/comment' }
					);
					if (Array.isArray(attachmentIds) && attachmentIds.length > 0) {
						ret.then(refreshRootData).catch(() => {});
					}
					return ret;
        },
        [asyncFetcher]
      ),
      share: useCallback(
        async (args) =>
          asyncFetcher.submit(
            // tags: the quote caption's harvested inline #hashtags — merged
            // server-side with the tags carried from the original post
            { id: args?.id, text: args?.text, tags: args?.tags, acl: args?.acl, visibility: args?.visibility },
            { action: '/api/v1/things/share' }
          ),
        [asyncFetcher]
      ),
			remove: useCallback(
				async (args) => {
					const ret = asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/things', method: 'DELETE' });
					ret.then(refreshRootData).catch(() => {});
					return ret;
				},
				[asyncFetcher]
			)
    },
    // "Login with Thingtime" grants — the user's connected apps
    oauth: {
      grants: useCallback(async () => getJson('/api/v1/oauth/grants'), []),
      revokeGrant: useCallback(
        async (args) => asyncFetcher.submit({ clientId: args?.clientId }, { action: '/api/v1/oauth/grants/revoke' }),
        [asyncFetcher]
      )
    },
    // first-party browsing of app namespaces (what has each app stored for me)
    apps: {
      list: useCallback(async () => getJson('/api/v1/apps'), []),
      storage: useCallback(async (args: { clientId: string }) => getJson(`/api/v1/apps/storage${toQuery({ clientId: args?.clientId })}`), []),
      setStorage: useCallback(
        async (args: {
          clientId: string;
          action: 'set-tier' | 'set-default-user-cap' | 'set-user-cap';
          tier?: string;
          tierVersionId?: string;
          allowanceBytes?: number | null;
          userIds?: string[];
        }) => asyncFetcher.submit(args, { action: '/api/v1/apps/storage' }),
        [asyncFetcher]
      ),
      dataSummary: useCallback(async () => getJson('/api/v1/apps/data-summary'), []),
      dataShared: useCallback(
        async (args) =>
          getJson(
            `/api/v1/apps/data/shared${toQuery({
              appId: args?.appId,
              thingtime: args?.thingtime,
              cursor: args?.cursor,
              limit: args?.limit
            })}`
          ),
        []
      ),
      dataDeleteAll: useCallback(
        async (args) => asyncFetcher.submit({ appId: args?.appId }, { action: '/api/v1/apps/data/delete-all' }),
        [asyncFetcher]
      )
    },
    tokens: {
      // personal access tokens (Settings → Token minter) — the mint response
      // carries the token string exactly once
      list: useCallback(async () => getJson('/api/v1/tokens'), []),
      mint: useCallback(
        async (args) =>
          asyncFetcher.submit(
            {
              name: args?.name,
              scopes: args?.scopes,
              expiresInMs: args?.expiresInMs ?? null,
              maxUses: args?.maxUses ?? null,
              onlyCreatedThings: args?.onlyCreatedThings === true,
              visibility: args?.visibility ?? 'all'
            },
            { action: '/api/v1/tokens' }
          ),
        [asyncFetcher]
      ),
      revoke: useCallback(async (args) => asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/tokens/revoke' }), [asyncFetcher])
    },
    algorithms: {
      list: useCallback(async () => getJson('/api/v1/algorithms'), []),
      // share-link preview (identity + training size only, never weights)
      getShared: useCallback(
        async (args) => getJson(`/api/v1/algorithms/shared?id=${encodeURIComponent(args?.id || '')}`),
        []
      ),
      create: useCallback(
        async (args) => {
          const { name, emoji, branchFrom, events } = args;
          return asyncFetcher.submit({ name, emoji, branchFrom, events }, { action: '/api/v1/algorithms' });
        },
        [asyncFetcher]
      ),
      update: useCallback(
        async (args) =>
          asyncFetcher.submit({ id: args?.id, name: args?.name, emoji: args?.emoji, shared: args?.shared }, { action: '/api/v1/algorithms/update' }),
        [asyncFetcher]
      ),
      remove: useCallback(
        async (args) => {
          const ret = asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/algorithms/delete' });
          // deleting the active algorithm clears the server-side pointer —
          // refresh so the feed doesn't keep requesting a dead algorithm
          ret.then(refreshRootData).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      ),
      setActive: useCallback(
        async (args) => {
          const ret = asyncFetcher.submit({ algorithmId: args?.algorithmId ?? null }, { action: '/api/v1/algorithms/active' });
          ret.then(refreshRootData).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      ),
      track: useCallback(
        async (args) => asyncFetcher.submit({ algorithmId: args?.algorithmId, events: args?.events }, { action: '/api/v1/algorithms/track' }),
        [asyncFetcher]
      )
    },
    social: {
      // counts + viewer relationship state for a profile ({ username | userId })
      relationships: useCallback(async (args) => getJson(`/api/v1/users/relationships${toQuery(args)}`), []),
      // paged lists: { username | userId, type: followers|following|friends|requests, limit, before }
      connections: useCallback(async (args) => getJson(`/api/v1/users/connections${toQuery(args)}`), []),
      // toggle (or explicitly set with follow: boolean) a one-way follow
      follow: useCallback(
        async (args) =>
					asyncFetcher.submit({ userId: args?.userId, username: args?.username, follow: args?.follow }, { action: '/api/v1/users/follow' }),
        [asyncFetcher]
      ),
      // friendship state machine: intent request|cancel|accept|decline|unfriend
      friend: useCallback(
        async (args) =>
					asyncFetcher.submit({ userId: args?.userId, username: args?.username, intent: args?.intent }, { action: '/api/v1/users/friend' }),
        [asyncFetcher]
      )
    },
    notifications: {
      list: useCallback(async (args?: Record<string, unknown>) => getJson(`/api/v1/notifications${toQuery(args)}`), []),
      markRead: useCallback(
				async (args) => asyncFetcher.submit(args?.all ? { all: true } : { ids: args?.ids }, { action: '/api/v1/notifications/read' }),
        [asyncFetcher]
      ),
      settings: {
        get: useCallback(async () => getJson('/api/v1/notifications/settings'), []),
				set: useCallback(async (args) => asyncFetcher.submit({ prefs: args?.prefs }, { action: '/api/v1/notifications/settings' }), [asyncFetcher])
      }
    },
    profile: {
      get: useCallback(async (args) => getJson(`/api/v1/users/profile${toQuery(args)}`), []),
      // day-bucketed viewer-visible thing counts for the profile heatmap ({ username })
      activity: useCallback(async (args) => getJson(`/api/v1/users/activity${toQuery(args)}`), []),
      // public people search (the /search People rail)
      search: useCallback(async (args) => getJson(`/api/v1/users/search${toQuery(args)}`), []),
      update: useCallback(
        async (args) => {
					const body: Record<string, unknown> = {};
					for (const key of [
						'displayName',
						'bio',
						'avatarUrl',
						'bannerUrl',
						'avatarAttachmentId',
						'bannerAttachmentId',
						'birthday'
					] as const) {
						if (Object.prototype.hasOwnProperty.call(args || {}, key)) body[key] = args?.[key];
					}
					const ret = asyncFetcher.submit(body, { action: '/api/v1/users/profile' });
          ret.then(refreshRootData).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      )
    },
    themes: {
      list: useCallback(async () => getJson('/api/v1/themes'), []),
      getShared: useCallback(async (args) => getJson(`/api/v1/themes/shared?id=${encodeURIComponent(args?.id || '')}`), []),
      // public gallery list (no id → every public theme, newest first). The
      // arg is optional: callers that want the server default call this with
      // no arguments at all.
      listShared: useCallback(
        async (args?: { limit?: number }) =>
          getJson(`/api/v1/themes/shared${args?.limit ? `?limit=${encodeURIComponent(args.limit)}` : ''}`),
        []
      ),
      save: useCallback(
        async (args) => {
          const { id, name, theme, visibility } = args;
          return asyncFetcher.submit({ id, name, theme, visibility }, { action: '/api/v1/themes' });
        },
        [asyncFetcher]
      ),
      remove: useCallback(async (args) => asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/themes/delete' }), [asyncFetcher]),
      setActive: useCallback(
        async (args) => {
          const ret = asyncFetcher.submit({ themeId: args?.themeId ?? null }, { action: '/api/v1/themes/active' });
          ret.then(refreshRootData).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      )
    },
    schemas: {
      list: useCallback(async () => getJson('/api/v1/schemas'), []),
      get: useCallback(async (id) => getJson(`/api/v1/schemas${toQuery({ id })}`), []),
      // paginated UGC schema browsing — { q, sort, cursor, limit, library, mine }
      browse: useCallback(async (args) => getJson(`/api/v1/schemas/browse${toQuery(args)}`), [])
    },
    components: {
      // paginated component browsing — { q, sort, cursor, limit, lib, category, library, mine }
      browse: useCallback(async (args) => getJson(`/api/v1/components/browse${toQuery(args)}`), [])
      // creation rides the unified path: things.create({ thingtime: ['component'], crystal })
    },
    actions: {
      // execute one action inside its capability + budget envelope.
      // The body comes from the shared pure builder rather than an inline key
      // list: `source` is a security control (it narrows server-side
      // resolution to actions the viewer owns — execute.ts ownedOnly), and an
      // inline list silently dropped it, disarming the delegated ttAction
      // path in every browser while the API-level battery stayed green.
      run: useCallback(async (args) => asyncFetcher.submit(buildActionRunBody(args), { action: '/api/v1/actions/run' }), [asyncFetcher]),
      // your own run records — { action, limit }
      runs: useCallback(async (args) => getJson(`/api/v1/actions/runs${toQuery(args)}`), [])
      // creation rides the unified path: things.create({ thingtime: ['action'], crystal })
    },
    waitlist: {
      join: useCallback(async (args) => asyncFetcher.submit({ email: args?.email }, { action: '/api/v1/waitlist' }), [asyncFetcher])
    }
  };

  const ret = {
    v1
  };

  return ret;
}
