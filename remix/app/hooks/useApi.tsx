import { useCallback } from 'react';

import { useAsyncFetcher } from './useAsyncFetcher';

const refreshRootData = () => {
  window.dispatchEvent(new Event('thingtime:root-data-refresh'));
};

// GET helper mirroring useAsyncFetcher semantics: parses JSON and throws the
// parsed payload on !ok so callers catch { ok: false, error } shapes.
const getJson = async (url: string) => {
  const response = await fetch(url, { credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw data;
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
          const ret = asyncFetcher.submit(
            { username, password, email, displayName },
            { action: '/api/v1/auth/register' }
          );
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
        request: useCallback(
          async (args) => asyncFetcher.submit({ email: args?.email }, { action: '/api/v1/auth/password-reset' }),
          [asyncFetcher]
        ),
        confirm: useCallback(
          async (args) =>
            asyncFetcher.submit(
              { token: args?.token, password: args?.password },
              { action: '/api/v1/auth/password-reset/confirm' }
            ),
          [asyncFetcher]
        )
      },
      twoFactor: {
        get: useCallback(async () => getJson('/api/v1/auth/two-factor'), []),
        set: useCallback(
          async (args) => asyncFetcher.submit({ enabled: !!args?.enabled }, { action: '/api/v1/auth/two-factor' }),
          [asyncFetcher]
        )
      },
      logout: useCallback(
        async (args?: { all?: boolean }) => {
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
        )
      }
    },
    admin: {
      rateLimits: useCallback(async () => getJson('/api/v1/admin/rate-limits'), []),
      setRateLimits: useCallback(
        async (endpoints) => asyncFetcher.submit({ endpoints }, { action: '/api/v1/admin/rate-limits' }),
        [asyncFetcher]
      ),
      users: useCallback(async (args) => getJson(`/api/v1/admin/users${toQuery(args)}`), []),
      setAdmin: useCallback(
        async (args) => asyncFetcher.submit({ userId: args?.userId, admin: args?.admin }, { action: '/api/v1/admin/set-admin' }),
        [asyncFetcher]
      ),
      migrations: useCallback(async () => getJson('/api/v1/admin/migrations'), []),
      migrationsRun: useCallback(
        async (args) =>
          asyncFetcher.submit(
            { migration: args?.migration, dryRun: args?.dryRun, confirm: args?.confirm },
            { action: '/api/v1/admin/migrations/run' }
          ),
        [asyncFetcher]
      )
    },
    mongodb: {
      capabilities: useCallback(async () => getJson('/api/v1/mongodb/raw-results'), []),
      rawResults: useCallback(
        async (args, options?: { signal?: AbortSignal }) =>
          asyncFetcher.submit(args, { action: '/api/v1/mongodb/raw-results', signal: options?.signal }),
        [asyncFetcher]
      )
    },
    things: {
      feed: useCallback(async (args) => getJson(`/api/v1/things/feed${toQuery(args)}`), []),
      // structured search — POST carries the condition tree (read-only despite
      // the verb); see /docs/api things-search
      search: useCallback(
        async (args) => asyncFetcher.submit(args || {}, { action: '/api/v1/things/search' }),
        [asyncFetcher]
      ),
      userPosts: useCallback(async (args) => getJson(`/api/v1/things/user${toQuery(args)}`), []),
      get: useCallback(async (args) => getJson(`/api/v1/things${toQuery({ id: args?.id })}`), []),
      list: useCallback(
        async (args) =>
          getJson(
            `/api/v1/things${toQuery({
              target: args?.target,
              thingtime: args?.thingtime,
              cursor: args?.cursor,
              limit: args?.limit
            })}`
          ),
        []
      ),
      update: useCallback(
        async (args) =>
          asyncFetcher.submit(
            { id: args?.id, crystal: args?.crystal, acl: args?.acl, visibility: args?.visibility, tags: args?.tags },
            { action: '/api/v1/things', method: 'PATCH' }
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
              tags: args?.tags
            },
            { action: '/api/v1/things', method: 'PUT' }
          ),
        [asyncFetcher]
      ),
      reactionsRecent: useCallback(async () => getJson('/api/v1/things/reactions-recent'), []),
      create: useCallback(
        async (args) => {
          const { type, text, images, listing, thing, thingtime, crystal, targetId, acl, visibility, tags } = args;
          // unified shape when thingtime is given, legacy post shape otherwise
          const payload = Array.isArray(thingtime)
            ? { thingtime, crystal, targetId, acl, visibility, tags }
            : { type, text, images, listing, thing, acl, visibility, tags };
          return asyncFetcher.submit(payload, { action: '/api/v1/things' });
        },
        [asyncFetcher]
      ),
      react: useCallback(
        async (args) => asyncFetcher.submit({ id: args?.id, emoji: args?.emoji ?? null }, { action: '/api/v1/things/react' }),
        [asyncFetcher]
      ),
      // toggle a private "add to my library" save on any visible thing
      save: useCallback(
        async (args) => asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/things/save' }),
        [asyncFetcher]
      ),
      comment: useCallback(
        // simple text comments send { id, text }; rich comments add
        // type/images/listing/thing/tags — comments share the post schema
        async (args) => {
          const { id, text, type, images, listing, thing, tags } = args || {};
          return asyncFetcher.submit({ id, text, type, images, listing, thing, tags }, { action: '/api/v1/things/comment' });
        },
        [asyncFetcher]
      ),
      share: useCallback(
        async (args) =>
          asyncFetcher.submit(
            { id: args?.id, text: args?.text, acl: args?.acl, visibility: args?.visibility },
            { action: '/api/v1/things/share' }
          ),
        [asyncFetcher]
      ),
      remove: useCallback(
        async (args) => asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/things', method: 'DELETE' }),
        [asyncFetcher]
      )
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
        async (args) =>
          asyncFetcher.submit({ id: args?.id, name: args?.name, emoji: args?.emoji }, { action: '/api/v1/algorithms/update' }),
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
          const ret = asyncFetcher.submit(
            { algorithmId: args?.algorithmId ?? null },
            { action: '/api/v1/algorithms/active' }
          );
          ret.then(refreshRootData).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      ),
      track: useCallback(
        async (args) =>
          asyncFetcher.submit(
            { algorithmId: args?.algorithmId, events: args?.events },
            { action: '/api/v1/algorithms/track' }
          ),
        [asyncFetcher]
      )
    },
    profile: {
      get: useCallback(async (args) => getJson(`/api/v1/users/profile${toQuery(args)}`), []),
      // public people search (the /search People rail)
      search: useCallback(async (args) => getJson(`/api/v1/users/search${toQuery(args)}`), []),
      update: useCallback(
        async (args) => {
          const { displayName, bio, avatarUrl, bannerUrl } = args;
          const ret = asyncFetcher.submit(
            { displayName, bio, avatarUrl, bannerUrl },
            { action: '/api/v1/users/profile' }
          );
          ret.then(refreshRootData).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      )
    },
    themes: {
      list: useCallback(async () => getJson('/api/v1/themes'), []),
      getShared: useCallback(
        async (args) => getJson(`/api/v1/themes/shared?id=${encodeURIComponent(args?.id || '')}`),
        []
      ),
      save: useCallback(
        async (args) => {
          const { id, name, theme, visibility } = args;
          return asyncFetcher.submit({ id, name, theme, visibility }, { action: '/api/v1/themes' });
        },
        [asyncFetcher]
      ),
      remove: useCallback(
        async (args) => asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/themes/delete' }),
        [asyncFetcher]
      ),
      setActive: useCallback(
        async (args) => {
          const ret = asyncFetcher.submit(
            { themeId: args?.themeId ?? null },
            { action: '/api/v1/themes/active' }
          );
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
      join: useCallback(
        async (args) => asyncFetcher.submit({ email: args?.email }, { action: '/api/v1/waitlist' }),
        [asyncFetcher]
      )
    }
  };

  const ret = {
    v1
  };

  return ret;
}
