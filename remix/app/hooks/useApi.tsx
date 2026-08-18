import { useCallback } from 'react';

import { flushAttachmentDraftCleanups } from '~/components/Attachments/attachmentDraftCleanup';
import type { AttachmentUploadPurpose } from '~/components/Attachments/attachmentTypes';
import { useAsyncFetcher } from './useAsyncFetcher';
import { clearLocalCachePrefix } from './localCache';
import { createApiFailure, readApiResponsePayload } from './apiFailure';

const refreshRootData = () => {
  window.dispatchEvent(new Event('thingtime:root-data-refresh'));
};

// GET helper mirroring useAsyncFetcher semantics: parses JSON and throws the
// parsed payload on !ok so callers catch { ok: false, error } shapes.
const getJson = async (url: string, options?: { signal?: AbortSignal }) => {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include', signal: options?.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw createApiFailure({ cause: error, action: 'load Thingtime data', method: 'GET' });
  }
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
      }
    },
    settings: {
      // Public so the GitHub conflict resolver can read the same ordered model
      // waterfall as the admin UI without inheriting an admin browser session.
			prConflictResolverModelWaterfall: useCallback(async () => getJson('/api/v1/settings/pr-conflict-auto-resolver-model-waterfall'), [])
    },
    admin: {
      ciControl: useCallback(
				async (args?: { limit?: number }, options?: { signal?: AbortSignal }) => getJson(`/api/v1/admin/ci${toQuery(args)}`, options),
        []
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
      setPrConflictResolverModelWaterfall: useCallback(
				async (waterfall) => asyncFetcher.submit({ waterfall }, { action: '/api/v1/settings/pr-conflict-auto-resolver-model-waterfall' }),
        [asyncFetcher]
      ),
      rateLimits: useCallback(async () => getJson('/api/v1/admin/rate-limits'), []),
      setRateLimits: useCallback(async (endpoints) => asyncFetcher.submit({ endpoints }, { action: '/api/v1/admin/rate-limits' }), [asyncFetcher]),
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
				async (args: { id: string }) => {
					const ret = asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/attachments/delete', errorContext: 'remove a draft file' });
					ret.then(refreshRootData).catch(() => {});
					return ret;
				},
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
              // attachment reorder — only send when the caller provides it
              // (the ids must be a permutation of the post's bound set)
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
					const { type, text, images, listing, thing, thingtime, crystal, targetId, folderId, acl, visibility, tags, tokenAcl, attachmentIds, shareId } = args;
          // unified shape when thingtime is given, legacy post shape otherwise
          const payload = Array.isArray(thingtime)
						? { thingtime, crystal, targetId, folderId, acl, visibility, tags, tokenAcl, attachmentIds, shareId }
						: { type, text, images, listing, thing, acl, visibility, tags, attachmentIds, shareId };
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
      // cast/move/remove the caller's vote on a visible poll thing
      vote: useCallback(
        async (args: { id: string; optionIndex: number }) =>
          asyncFetcher.submit({ id: args?.id, optionIndex: args?.optionIndex }, { action: '/api/v1/things/vote', errorContext: 'save your vote' }),
        [asyncFetcher]
      ),
      comment: useCallback(
        // simple text comments send { id, text }; rich comments add
				// type/images/listing/thing/tags/attachments — comments share the post schema
        async (args) => {
					const { id, text, type, images, listing, thing, tags, shareId, attachmentIds } = args || {};
					const ret = asyncFetcher.submit(
						{ id, text, type, images, listing, thing, tags, shareId, attachmentIds },
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
              onlyCreatedThings: args?.onlyCreatedThings === true
            },
            { action: '/api/v1/tokens' }
          ),
        [asyncFetcher]
      ),
      revoke: useCallback(async (args) => asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/tokens/revoke' }), [asyncFetcher])
    },
    algorithms: {
      list: useCallback(async () => getJson('/api/v1/algorithms'), []),
      create: useCallback(
        async (args) => {
          const { name, emoji, branchFrom, events } = args;
          return asyncFetcher.submit({ name, emoji, branchFrom, events }, { action: '/api/v1/algorithms' });
        },
        [asyncFetcher]
      ),
      update: useCallback(
        async (args) => asyncFetcher.submit({ id: args?.id, name: args?.name, emoji: args?.emoji }, { action: '/api/v1/algorithms/update' }),
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
					for (const key of ['displayName', 'bio', 'avatarUrl', 'bannerUrl', 'avatarAttachmentId', 'bannerAttachmentId'] as const) {
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
    waitlist: {
      join: useCallback(async (args) => asyncFetcher.submit({ email: args?.email }, { action: '/api/v1/waitlist' }), [asyncFetcher])
    }
  };

  const ret = {
    v1
  };

  return ret;
}
