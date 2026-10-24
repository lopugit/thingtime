import { characterApi, withCharacterRequest } from '../local-workspace/characterRequest.client';
import { useLocalApiView } from '../local-workspace/LocalApiView';
import { parseTimelineVersionExport, timelineVersionExportRequirement } from '../timeline/exportVersion';
import { startNotificationHistorySync } from '../local-workspace/notifications.client';
import { WorkspaceApiIdentity } from '../local-workspace/apiIdentity';
import { useOfflineWorkspace, type WorkspaceUser } from './useWorkspaceUser';
import { accountApi, startAccountWorkspaceSync, type AccountLocalView } from '../local-workspace/accountApi.client';
import { anonymousApi } from '../local-workspace/api.client';
import { hasLiveSourceBinding } from '~/schemas/liveSources';
import { FILE_SYNC_REQUIREMENTS } from '~/fileSync/configuration';
import { parseCloudFile, parseCloudFileCommit, type CloudFileCommit } from '~/fileSync/cloudFile';
import type { TimelineScope } from '~/timeline/contract';
import { useCharacterScope, CHARACTER_HEADER } from '~/components/Characters/CharacterScope';
import type { VersionRequest } from '../timeline/publishedVersion';
import type { BranchCheckoutRequest } from '../timeline/branchCheckout';
import { timelineRequestScope, type TimelineStorage } from '../timeline/storageScope';
import { draftRequest } from '~/drafts/draftClient';
import type { BranchMergeRequest } from '../timeline/branchMerge';
import { parseTimelineBranchLookup, parseTimelineBranchLookupResult, type TimelineBranchCommand } from '../timeline/branches';
import type { TimelineNoteCommand } from '../timeline/notes';
import type { TimelineVersionNameCommand } from '../timeline/versionNames';
import { browserActionMinimumVersion } from '~/schemas/actionRequestPagination';
import type { TimelineEvent } from '~/timeline/contract';
import { retainActionOutcomeRecovery, type ActionOutcomeRecovery } from '~/timeline/actionRecovery';
import { enqueueActionOutcomeRecovery } from '~/timeline/localBackend.client';
import type { TimelinePageRequest } from '~/timeline/sync';
import { announceTimelineScopeChange } from '~/timeline/clientEvents';
import { ensureFoundPostBrowserIdentity } from './foundPostIdentity.client';
import { useCallback, useEffect, useRef } from 'react';
import { useCurrentUser, useRootUser } from './useCurrentUser';
import { useDataPlane } from './useDataPlane';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { rootIdentity } from '../utils/rootIdentity';
import { createBrowserActionHost, finishBrowserAction } from '~/components/Actions/browserActionHost';
import { withPostRequestDeadline } from './postRequest';
import { isDefaultAlgorithm } from '~/components/Feed/defaultAlgorithms';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { AI_COMPLETION_REQUIREMENTS, type AiCompletionInput } from '~/api/utils/ai/completionCore';

import { buildActionRunBody } from '~/components/Actions/actionRunRequest';
import { flushAttachmentDraftCleanups } from '~/components/Attachments/attachmentDraftCleanup';
import type { AttachmentUploadPurpose } from '~/components/Attachments/attachmentTypes';
import { ATTACHMENT_ARCHIVE_REQUIREMENTS, attachmentArchiveUrl } from '~/components/Attachments/attachmentUiCore';
import { postLopuReply, type LopuReplyBody } from '~/components/Lopu/lopuChatStream';
import { recordApiCall } from './apiRequestLog';
import { useAsyncFetcher } from './useAsyncFetcher';
import { clearLocalCachePrefix } from './localCache';
import { createApiFailure, readApiResponsePayload } from './apiFailure';
import { buildThingCommentRequestPayload, buildThingCreateRequestPayload, requiresUncappedDataStrings } from './thingsRequestPayload';
import { withExportDeadline } from '~/utils/thingTransfer/exportDeadline';

const refreshRootData = () => {
  window.dispatchEvent(new Event('thingtime:root-data-refresh'));
};

// GET helper mirroring useAsyncFetcher semantics: parses JSON and throws the
// parsed payload on !ok so callers catch { ok: false, error } shapes.
// Every call is recorded in the DevKit request log (method/path/status/ms).
export type ThingRequestOptions = { signal?: AbortSignal; expectedDataPlane?: string | null; expectedActor?: string; expectedApiOrigin?: string; characterId?: string };
const getJsonRequest = async (url: string, options?: ThingRequestOptions) => {
  if (url.startsWith('/api/v1/things')) ensureFoundPostBrowserIdentity();
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include', signal: options?.signal,
      ...(options?.expectedApiOrigin ? { redirect: 'error' as const, cache: 'no-store' as const } : {}),
      headers: { ...(options?.expectedApiOrigin ? { 'X-Thingtime-Expected-Api-Origin': options.expectedApiOrigin } : {}), ...(options?.expectedDataPlane ? { [EXPECTED_DATA_PLANE_HEADER]: options.expectedDataPlane } : {}), ...(options?.expectedActor ? { 'X-Thingtime-Expected-Actor': options.expectedActor } : {}), ...(options?.characterId ? { [CHARACTER_HEADER]: options.characterId } : {}) } });
    if (options?.expectedApiOrigin && (response.redirected || (options.expectedApiOrigin !== window.location.origin && response.headers.get('x-thingtime-api-fallback') !== options.expectedApiOrigin))) {
      await response.body?.cancel().catch(() => {});
      throw Error('The selected API server changed.');
    }
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
    if (response.status === 409 && data?.code === 'DATA_PLANE_CHANGED') { rootIdentity.changed(); refreshRootData(); }
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
export type { TimelineVersionExport } from '../timeline/exportVersion';

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

/** An explicit actor selects the same fenced workspace used by CharacterScope;
 * null selects the principal. It never supplies server delegation authority. */
export function useApi(explicitView?: AccountLocalView, actorOverride?: WorkspaceUser | null) {
  const inheritedView = useLocalApiView();
  const view = explicitView ?? inheritedView;
  const inheritedCharacter = useCharacterScope(), rootUser = useRootUser(), offlineWorkspace = useOfflineWorkspace();
  const principalId = rootUser?.id || offlineWorkspace?.ownerId;
  // The anonymous editor's display identity is not a delegated account.
  const explicitActor = actorOverride?.localOnly ? null : actorOverride;
  const selectedCharacter = explicitActor === undefined ? inheritedCharacter : explicitActor;
  const character = selectedCharacter?.id === principalId ? undefined : selectedCharacter;
  const getJson = useCallback(async (url: string, options?: ThingRequestOptions) => {
    if (!character) return getJsonRequest(url, options);
    return withCharacterRequest(async (signal, scope) => {
      await requireThingtimeCapability('api.auth-characters', '1.0.0');
      signal.throwIfAborted();
      return getJsonRequest(url, { expectedActor: character.id, expectedDataPlane: scope.dataPlane, ...options, characterId: character.id, signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal });
    });
  }, [character]);
  const dataPlane = useDataPlane();
  const planeRef = useRef(dataPlane); planeRef.current = dataPlane;
  const asyncFetcher = useAsyncFetcher(character ?? null);
  const inheritedUser = useCurrentUser();
  const actionUser = explicitActor === undefined ? inheritedUser : explicitActor || rootUser;
  const delegated = !!character && character.id !== rootUser?.id;
  const actionPrincipal = useRef(principalId); actionPrincipal.current = principalId;
  const actionActor = useRef(actionUser?.id);
  actionActor.current = actionUser?.id;

  const v1 = {
    files: {
      read: useCallback(async (scope: TimelineScope, id: string, options?: { signal?: AbortSignal }) => {
        if (scope.dataPlane !== 'home') throw Error('Files require home storage.');
        await requireThingtimeCapability('api.files', '1.0.0');
        await requireThingtimeCapability('api.actions-run', '1.7.0');
        await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
        const result = await getJson(`/api/v1/files${toQuery({ id })}`, { ...options, expectedActor: scope.ownerId, expectedDataPlane: 'home', expectedApiOrigin: scope.apiOrigin });
        const file = parseCloudFile(result?.file);
        if (file.id !== id) throw Error('File identity changed.');
        return file;
      }, []),
      commit: useCallback(async (scope: TimelineScope, input: CloudFileCommit, options?: { signal?: AbortSignal }) => {
        if (scope.dataPlane !== 'home') throw Error('Files require home storage.');
        const command = parseCloudFileCommit(input);
        await requireThingtimeCapability('api.files', '1.0.0');
        await requireThingtimeCapability('api.actions-run', '1.7.0');
        return asyncFetcher.submit(command, { action: '/api/v1/files', ...options, expectedActor: scope.ownerId, expectedDataPlane: 'home', expectedApiOrigin: scope.apiOrigin });
      }, [asyncFetcher])
    },
    drafts: useCallback((input?: Record<string, unknown>, query?: Record<string, string>) => draftRequest(actionActor.current || '', input, query), []),
    webpages: {
      resolveComponents: useCallback(async (scope: { ownerId: string; dataPlane: string }, blocks: unknown[], options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.webpages-resolve', '1.5.0');
        return asyncFetcher.submit({ blocks }, { action: `/api/v1/webpages/resolve${toQuery({ ownerId: scope.ownerId, dataPlane: scope.dataPlane })}`, expectedActor: scope.ownerId, expectedDataPlane: scope.dataPlane, signal: options?.signal });
      }, [asyncFetcher])
    },
    timeline: {
      canChangeLocally: (_scope: {ownerId: string; dataPlane: string}) => false,
      canExportLocally: (_scope: {ownerId: string; dataPlane: string}) => false,
      recoverOutcome: useCallback(async (scope: { ownerId: string; dataPlane: string }, recovery: ActionOutcomeRecovery, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.timeline', '1.16.0');
        return asyncFetcher.submit({ command: 'recover-action-outcome', recovery }, { action: `/api/v1/timeline${toQuery(timelineRequestScope(scope))}`, expectedActor: scope.ownerId, signal: options?.signal });
      }, [asyncFetcher]),
      componentBindings: useCallback(async (scope: { ownerId: string; dataPlane: string }, eventId: string, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.timeline', '1.10.0');
        return getJson(`/api/v1/timeline${toQuery({ ...timelineRequestScope(scope), eventId, components: 1 })}`, options);
      }, [getJson]),
      branchHead: useCallback(async (scope: { ownerId: string; dataPlane: string }, branchId: string, thingId: string, options?: { signal?: AbortSignal }) => {
        const lookup = parseTimelineBranchLookup({ branchId, thingId });
        await requireThingtimeCapability('api.timeline', '1.9.0');
        const result = await getJson(`/api/v1/timeline${toQuery({ ...timelineRequestScope(scope), ...lookup })}`, options);
        return parseTimelineBranchLookupResult(result, scope.ownerId, lookup);
      }, [getJson]),
      checkoutBranch: useCallback(async (scope: { ownerId: string; dataPlane: string }, request: BranchCheckoutRequest, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.timeline', '1.8.0');
        return asyncFetcher.submit(request, { action: `/api/v1/timeline${toQuery(timelineRequestScope(scope))}`, expectedActor: scope.ownerId, signal: options?.signal });
      }, [asyncFetcher]),
      branchMerge: useCallback(async (scope: { ownerId: string; dataPlane: string }, request: BranchMergeRequest, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.timeline', request.componentChoices === undefined ? '1.7.0' : '1.11.0');
        return asyncFetcher.submit(request, { action: `/api/v1/timeline${toQuery(timelineRequestScope(scope))}`, expectedActor: scope.ownerId, signal: options?.signal });
      }, [asyncFetcher]),
      entry: useCallback(async (scope: { ownerId: string; dataPlane: string }, eventId: string, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.timeline', scope.dataPlane === 'home' ? '1.6.0' : '1.2.0');
        return getJson(`/api/v1/timeline${toQuery({ ...timelineRequestScope(scope), eventId })}`, options);
      }, [getJson]),
      branches: useCallback(async (scope: { ownerId: string; dataPlane: string }, thingId: string, before?: number, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.timeline', scope.dataPlane === 'home' ? '1.6.0' : '1.2.0');
        return getJson(`/api/v1/timeline${toQuery({ ...timelineRequestScope(scope), thingId, branches: 1, before })}`, options);
      }, [getJson]),
      branch: useCallback(async (scope: { ownerId: string; dataPlane: string }, command: TimelineBranchCommand, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.timeline', scope.dataPlane === 'home' ? '1.6.0' : '1.2.0');
        return asyncFetcher.submit(command, { action: `/api/v1/timeline${toQuery(timelineRequestScope(scope))}`, expectedActor: scope.ownerId, signal: options?.signal });
      }, [asyncFetcher]),
      note: useCallback(async (scope: { ownerId: string; dataPlane: string }, command: TimelineNoteCommand, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.timeline', '1.19.0');
        return asyncFetcher.submit(command, { action: `/api/v1/timeline${toQuery(timelineRequestScope(scope))}`, expectedActor: scope.ownerId, signal: options?.signal });
      }, [asyncFetcher]),
      // Remote transport only. The History name queue persists local edits and calls this after verified discovery.
      nameVersion: useCallback(async (scope: { ownerId: string; dataPlane: string }, command: TimelineVersionNameCommand, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.timeline', '1.20.0');
        return asyncFetcher.submit(command, { action: `/api/v1/timeline${toQuery(timelineRequestScope(scope))}`, expectedActor: scope.ownerId, signal: options?.signal });
      }, [asyncFetcher]),
      // Strict gate: a 1.17 server answers `export=1&eventId=` with a plain entry read (HTTP 200), so the manifest is the only reliable signal.
      exportVersion: useCallback(async (scope: { ownerId: string; dataPlane: string }, eventId: string, options?: { signal?: AbortSignal; adapter?: string }) => {
        await requireThingtimeCapability('api.timeline', timelineVersionExportRequirement(options?.adapter));
        const result = await getJson(`/api/v1/timeline${toQuery({ ...timelineRequestScope(scope), eventId, export: 1 })}`, options);
        return parseTimelineVersionExport(result, {ownerId: scope.ownerId, id: eventId}, true);
      }, [getJson]),
      discover: useCallback(async (ownerId: string, options?: { signal?: AbortSignal; storage?: TimelineStorage }) => {
        const expectedDataPlane = planeRef.current;
        if (expectedDataPlane) await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
        await requireThingtimeCapability('api.timeline', options?.storage === 'home' ? '1.6.0' : '1.0.0');
        return getJson(`/api/v1/timeline${toQuery({ ownerId, ...(options?.storage === 'home' ? { storage: 'home' } : {}) })}`, { ...options, expectedDataPlane });
      }, [getJson]),
      page: useCallback(async (scope: { ownerId: string; dataPlane: string }, request: TimelinePageRequest, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.timeline', request.related ? '1.13.0' : scope.dataPlane === 'home' ? '1.6.0' : '1.0.0');
        return getJson(`/api/v1/timeline${toQuery({ ...timelineRequestScope(scope), ...request, ...(request.related ? { related: 1 } : {}), ...(request.thingId === null ? { history: 1 } : {}) })}`, options);
      }, [getJson]),
      push: useCallback(async (scope: { ownerId: string; dataPlane: string }, event: TimelineEvent, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.timeline', scope.dataPlane === 'home' ? '1.6.0' : '1.0.0');
        return asyncFetcher.submit(event, { action: `/api/v1/timeline${toQuery(timelineRequestScope(scope))}`, expectedActor: scope.ownerId, signal: options?.signal });
      }, [asyncFetcher]),
      version: useCallback(async (scope: { ownerId: string; dataPlane: string }, request: VersionRequest) => {
        // Undo first: it always carries componentMode, which alone would negotiate 1.12.0 and earn a 400 from an older server.
        await requireThingtimeCapability('api.timeline', request.mode === 'undo' ? '1.18.0' : request.recover ? '1.14.0' : request.componentMode ? '1.12.0' : scope.dataPlane === 'home' ? '1.6.0' : '1.1.0');
        return asyncFetcher.submit(request, { action: `/api/v1/timeline${toQuery(timelineRequestScope(scope))}`, expectedActor: scope.ownerId });
      }, [asyncFetcher])
    },
    tiers: useCallback(async (options?: { signal?: AbortSignal }) => {
      await requireThingtimeCapability('api.tiers', '1.1.0');
      return getJson('/api/v1/tiers', options);
    }, [getJson]),
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
        get: useCallback(async () => getJson('/api/v1/auth/two-factor'), [getJson]),
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
          clearLocalCachePrefix('tt-passkeys');
          // the /notifications history seed quotes private posts and the
          // viewer's own action runs — same shared-browser privacy bar
          clearLocalCachePrefix('tt-notif-history-');
          // builder-page source results are whole action results run AS the
          // viewer (their orders, their expense rows, their trainer) cached to
          // paint /p/<page> without a spinner — the same shared-browser rule.
          // The keys carry the viewer id, so a stale line can no longer be
          // READ by the next account; dropping them here also stops it
          // outliving the session that authorized it on disk.
          clearLocalCachePrefix('tt-page-source:');
          // /thing/:id caches the whole ACL-gated projection of each thing the
          // viewer opened (private posts, circle data, their own components) to
          // paint the permalink without a spinner. Same viewer-id keying and so
          // the same shared-browser rule as the four caches above.
          clearLocalCachePrefix('tt-thing-');
          // /components/:key caches the ACL-gated browse projection of a
          // component family — including the viewer's own unpublished designs
          // and their author block. Same viewer-id keying, same rule.
          clearLocalCachePrefix('tt-component-family-');
          // /schemas/:key caches "your things with this shape": the viewer's
          // OWN data things, crystal and all. The most private of the set.
          clearLocalCachePrefix('tt-schema-things-');
          // Lopu's caches (conversations, messages, model catalog, the
          // floating window's last state) are the viewer's private chat
          // with the assistant — same shared-browser privacy bar.
          clearLocalCachePrefix('tt-lopu-');
          const ret = asyncFetcher.submit(args?.all ? { all: true } : {}, { action: '/api/v1/auth/logout' });
          ret.then(refreshRootData).catch(() => {});
          return ret;
        },
        [asyncFetcher]
      ),
      accounts: {
        // Listing changes no state, so no refreshRootData (pruning only rewrites
        // the roster cookie, never the active user).
        list: useCallback(async () => getJson('/api/v1/auth/accounts'), [getJson]),
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
        owned: useCallback(async () => getJson('/api/v1/auth/accounts/owned'), [getJson]),
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
      accountHints: useCallback(async () => getJson('/api/v1/auth/account-hints'), [getJson]),
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
        list: useCallback(async () => getJson('/api/v1/auth/passkeys'), [getJson]),
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
      lopuPrompt: useCallback(async (options?: { signal?: AbortSignal }) => getJson('/api/v1/settings/lopu-prompt', options), [getJson]),
      setLopuPrompt: useCallback(async (args: Record<string, unknown>) => {
        await requireThingtimeCapability('api.settings-lopu-prompt', '1.0.0');
        return asyncFetcher.submit(args, { action: '/api/v1/settings/lopu-prompt', errorContext: 'save Lopu instructions' });
      }, [asyncFetcher]),
      // Public so the GitHub conflict resolver can read the same ordered model
      // waterfall as the admin UI without inheriting an admin browser session.
			prConflictResolverModelWaterfall: useCallback(async () => getJson('/api/v1/settings/pr-conflict-auto-resolver-model-waterfall'), [getJson]),
			// Lopu's stored chat defaults ({ model, effort, speed }); public GET, admin POST (admin.setLopuChatDefaults)
			lopuChatDefaults: useCallback(async () => getJson('/api/v1/settings/lopu-chat-defaults'), [getJson]),
			// Thingtime.LopuAccess ({ requireVerification, allowByoUnverified, starterCredits,
			// lowBalanceWarningCredits }); public GET, admin POST (admin.setLopuAccess)
			lopuAccess: useCallback(async (options?: { signal?: AbortSignal }) => getJson('/api/v1/settings/lopu-access', options), [getJson])
    },
    // the `ai-model` catalog Lopu thinks with (public; { models, defaults, providers }
    // + for a signed-in viewer their Secure Vault providers as metadata only:
    // vaultProviders: [{ id, name, kind, model, endpointHost, available, reason? }], vault: { configured })
    ai: {
      models: useCallback(async () => {
        const result = await getJson('/api/v1/ai/models');
        if (result?.vaultProviders?.some((provider: { planChatEligible?: boolean }) => provider.planChatEligible === true)) {
          try { await requireThingtimeCapability('api.ai-models', '1.8.0'); }
          catch { return { ...result, vaultProviders: result.vaultProviders.map(({ planChatEligible: _hint, ...provider }: any) => provider) }; }
        }
        return result;
      }, [getJson]),
      complete: useCallback(async (input: AiCompletionInput) => {
        for (const [feature, minimum] of Object.entries(AI_COMPLETION_REQUIREMENTS)) await requireThingtimeCapability(feature, minimum);
        return asyncFetcher.submit(input, { action: '/api/v1/ai/complete', errorContext: 'complete text with your selected AI connections' });
      }, [asyncFetcher])
    },
    admin: {
      aiModels: useCallback(async () => getJson('/api/v1/admin/ai/models'), [getJson]),
      // { id, enabled } toggles one catalog model; { seed: true } re-runs the catalog upsert;
      // { probe: true } re-checks the provider keys (fresh providers.<p>.verified + the re-projected list)
      setAiModel: useCallback(
        async (args: { id?: string; enabled?: boolean; seed?: boolean; probe?: boolean; sync?: boolean; provider?: string; allowAll?: boolean; autoAllowNewModels?: boolean }) => {
          await requireThingtimeCapability('api.admin-ai-models', '1.4.0');
          return asyncFetcher.submit(args, { action: '/api/v1/admin/ai/models', errorContext: 'update the Lopu model catalog' });
        },
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
      // Thingtime.LopuAccess — who may use Lopu and what a new account starts with
      setLopuAccess: useCallback(
        async (args: { requireVerification?: boolean; allowByoUnverified?: boolean; starterCredits?: number; lowBalanceWarningCredits?: number }) =>
          asyncFetcher.submit(args, { action: '/api/v1/settings/lopu-access', errorContext: 'save the Lopu access settings' }),
        [asyncFetcher]
      ),
      // { userId, verified } — the per-account Lopu verified flag (meta.lopuVerified)
      setUserLopuAccess: useCallback(
        async (args: { userId: string; verified: boolean }) =>
          asyncFetcher.submit(
            { userId: args?.userId, verified: args?.verified },
            { action: '/api/v1/admin/users/lopu-access', errorContext: `${args?.verified ? 'verify' : 'unverify'} Lopu access` }
          ),
        [asyncFetcher]
      ),
      // Admin → Lopu accounts: rows { user, balanceMicros, month, lifetime, pendingRequest }, cursor-paged
      lopuAccounts: useCallback(
        async (args?: { q?: string; cursor?: string; limit?: number }, options?: { signal?: AbortSignal }) =>
          getJson(`/api/v1/admin/lopu/accounts${toQuery(args)}`, options),
        [getJson]
      ),
      // grant / adjust credits ({ userId, credits, entry, reason }), approve a
      // request ({ ...same, requestId }) or decline one ({ requestId, decline: true, reason })
      lopuCredits: useCallback(
        async (args: {
          userId?: string;
          credits?: number;
          entry?: 'grant' | 'topup' | 'adjust' | 'refund';
          reason?: string;
          requestId?: string;
          decline?: boolean;
        }) => asyncFetcher.submit(args, { action: '/api/v1/admin/lopu/credits', errorContext: 'update Lopu credits' }),
        [asyncFetcher]
      ),
      integrations: useCallback(async () => getJson('/api/v1/admin/integrations'), [getJson]),
      integrationAction: useCallback(
        async (args: Record<string, unknown>) =>
          asyncFetcher.submit(args, { action: '/api/v1/admin/integrations', errorContext: 'manage integration policy' }),
        [asyncFetcher]
      ),
      ciControl: useCallback(
				async (args?: { limit?: number }, options?: { signal?: AbortSignal }) => getJson(`/api/v1/admin/ci${toQuery(args)}`, options),
        [getJson]
      ),
      ciCredentials: useCallback(async (options?: { signal?: AbortSignal }) => getJson('/api/v1/admin/ci/credentials', options), [getJson]),
      ciFeatureStacks: useCallback(async (options?: { signal?: AbortSignal }) => getJson('/api/v1/admin/ci/stacks', options), [getJson]),
      ciStackChat: useCallback(async (runId: string) => getJson(`/api/v1/admin/ci/stacks/chat${toQuery({ runId })}`), [getJson]),
      sendCiStackQuestion: useCallback(async (args: Record<string, unknown>) => asyncFetcher.submit(args, { action: '/api/v1/admin/ci/stacks/chat', errorContext: 'ask Lopu about a stack run' }), [asyncFetcher]),
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
				async (waterfall) => {
          await requireThingtimeCapability('api.settings-pr-conflict-auto-resolver-model-waterfall', '1.1.0');
          return asyncFetcher.submit({ waterfall }, { action: '/api/v1/settings/pr-conflict-auto-resolver-model-waterfall' });
        },
        [asyncFetcher]
      ),
      rateLimits: useCallback(async () => getJson('/api/v1/admin/rate-limits'), [getJson]),
      setRateLimits: useCallback(async (endpoints) => asyncFetcher.submit({ endpoints }, { action: '/api/v1/admin/rate-limits' }), [asyncFetcher]),
			// A private, cursor-paged projection for the Developer → Deployment
			// peers explorer. This intentionally differs from /api/v1/peers,
			// whose HMAC + Ed25519 protocol is for deployments only.
			peers: useCallback(
				async (args?: { cursor?: string; limit?: number }, options?: { signal?: AbortSignal }) =>
					getJson(`/api/v1/admin/peers${toQuery(args)}`, options),
				[getJson]
			),
      users: useCallback(async (args) => getJson(`/api/v1/admin/users${toQuery(args)}`), [getJson]),
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
      moderation: useCallback(async () => getJson('/api/v1/admin/moderation'), [getJson]),
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
      migrations: useCallback(async () => {
        await requireThingtimeCapability('api.admin-migrations', '1.4.1');
        return getJson('/api/v1/admin/migrations');
      }, [getJson]),
			migrationDiagnostic: useCallback(
				async (args, options?: { signal?: AbortSignal }) => getJson(`/api/v1/admin/migrations/diagnostic${toQuery({ id: args?.id })}`, options),
				[getJson]
			),
      migrationsRun: useCallback(
        async (args) => {
          await requireThingtimeCapability('api.admin-migrations-run', '1.4.1');
          return asyncFetcher.submit(
            { migration: args?.migration, dryRun: args?.dryRun, confirm: args?.confirm },
            {
              action: '/api/v1/admin/migrations/run',
              errorContext: args?.dryRun ? `preview migration ${args?.migration}` : `run migration ${args?.migration}`
            }
          );
        },
        [asyncFetcher]
      ),
      usersOverview: useCallback(
        async (args?: { q?: string; limit?: number; cursor?: string }, options?: { signal?: AbortSignal }) =>
          getJson(`/api/v1/admin/users/overview${toQuery(args)}`, options),
        [getJson]
      ),
      apps: useCallback(
        async (args?: { q?: string; limit?: number; cursor?: string }, options?: { signal?: AbortSignal }) =>
          getJson(`/api/v1/admin/apps${toQuery(args)}`, options),
        [getJson]
      ),
      revokeApp: useCallback(
        async (args: { clientId: string; revoked: boolean }) =>
          asyncFetcher.submit({ clientId: args?.clientId, revoked: args?.revoked }, { action: '/api/v1/admin/apps/revoke' }),
        [asyncFetcher]
      ),
      subscription: useCallback(
        async (args: { subjectType: 'user' | 'app'; subjectId: string }) => getJson(`/api/v1/admin/subscriptions${toQuery(args)}`),
        [getJson]
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
      tiers: useCallback(async () => getJson('/api/v1/admin/tiers'), [getJson]),
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
        [getJson]
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
        list: useCallback(async (options?: { signal?: AbortSignal }) => getJson('/api/v1/lopu/chats', options), [getJson]),
        // providerId = one of the viewer's Secure Vault providers (v1.ai.models()
        // → vaultProviders[].id); null clears it back to the catalog model
        create: useCallback(
          async (args?: { title?: string; model?: string; effort?: string; speed?: string; providerId?: string | null; accessMode?: 'ask' | 'full'; management?: 'client' | 'server' }) => {
            if (typeof args?.providerId === 'string' && args.providerId.startsWith('chatgpt-plan-')) await requireThingtimeCapability('api.lopu-chats', '1.7.0');
            if (args?.accessMode) await requireThingtimeCapability('api.lopu-chats', '1.6.0');
            if (args?.management) await requireThingtimeCapability('api.lopu-chats', '1.5.0');
            return asyncFetcher.submit(args || {}, { action: '/api/v1/lopu/chats', errorContext: 'start a Lopu chat' });
          },
          [asyncFetcher]
        ),
        update: useCallback(
          async (args: { chatId: string; title?: string; model?: string; effort?: string; speed?: string; providerId?: string | null; accessMode?: 'ask' | 'full'; management?: 'client' | 'server'; archived?: boolean }) => {
            if (typeof args.providerId === 'string' && args.providerId.startsWith('chatgpt-plan-')) await requireThingtimeCapability('api.lopu-chats-update', '1.6.1');
            if (args.accessMode) await requireThingtimeCapability('api.lopu-chats-update', '1.5.0');
            if (args.management) {
              await requireThingtimeCapability('api.lopu-chats', '1.5.0');
              await requireThingtimeCapability('api.lopu-chats-update', '1.4.0');
            }
            if (args.archived !== undefined) {
              await requireThingtimeCapability('api.lopu-chats', '1.4.0');
              await requireThingtimeCapability('api.lopu-chats-update', '1.3.0');
            }
            return asyncFetcher.submit(args, { action: '/api/v1/lopu/chats/update', errorContext: 'update a Lopu chat' });
          },
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
        async (args: { providerId: string; model?: string | null; effort?: string | null; textResponse?: boolean }, options?: { signal?: AbortSignal }) => {
          await requireThingtimeCapability('api.lopu-voice-session', '1.2.0');
          return asyncFetcher.submit(args, { action: '/api/v1/lopu/voice/session', errorContext: 'start direct voice', signal: options?.signal });
        },
        [asyncFetcher]
      ),
      // the viewer's Lopu account (verified flag, credits, usage — design note
      // "Lopu verified access, usage accounting and credits" §3); session only
      account: {
        get: useCallback(async (options?: { signal?: AbortSignal }) => getJson('/api/v1/lopu/account', options), [getJson]),
        // ledger rows + the usage rows of the same window, newest first, cursor-paged (limit ≤ 100)
        history: useCallback(
          async (args?: { cursor?: string | null; limit?: number }, options?: { signal?: AbortSignal }) =>
            getJson(`/api/v1/lopu/account/history${toQuery({ cursor: args?.cursor ?? undefined, limit: args?.limit })}`, options),
          [getJson]
        ),
        // { credits: 0.5..1000, note? } — one pending request at a time (409)
        requestTopup: useCallback(
          async (args: { credits: number; note?: string }) =>
            asyncFetcher.submit({ credits: args?.credits, ...(args?.note ? { note: args.note } : {}) }, { action: '/api/v1/lopu/account/topup-request', errorContext: 'request Lopu credits' }),
          [asyncFetcher]
        )
      }
    },
    mongodb: {
      capabilities: useCallback(async () => getJson('/api/v1/mongodb/raw-results'), [getJson]),
      rawResults: useCallback(
        async (args, options?: { signal?: AbortSignal }) =>
          asyncFetcher.submit(args, { action: '/api/v1/mongodb/raw-results', signal: options?.signal }),
        [asyncFetcher]
      ),
      // session data-endpoint override (thin-frontend mode): which MongoDB the
      // data plane uses for this browser session
      endpoint: {
        get: useCallback(async () => getJson('/api/v1/mongodb/endpoint'), [getJson]),
        set: useCallback(
          async (args?: { url?: string; savedId?: string; reset?: boolean }) => {
            const body = args?.savedId ? { savedId: args.savedId } : args?.reset ? { reset: true } : { url: args?.url };
            // Reset/selection is the recovery path for a stale data source.
            const ret = asyncFetcher.submit(body, { action: '/api/v1/mongodb/endpoint', expectedDataPlane: null });
            ret.then(announceTimelineScopeChange).catch(() => {});
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
        list: useCallback(async () => getJson('/api/v1/mongodb/endpoints'), [getJson]),
        add: useCallback(
          async (args?: { name?: string; url?: string }) =>
            asyncFetcher.submit({ name: args?.name, url: args?.url }, { action: '/api/v1/mongodb/endpoints' }),
          [asyncFetcher]
        ),
        remove: useCallback(
          async (args?: { id?: string }) => {
            const ret = asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/mongodb/endpoints', method: 'DELETE', expectedDataPlane: null });
            ret.then(announceTimelineScopeChange).catch(() => {});
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
    things: {
      fork: useCallback(async (args: { id: string; key?: string }) => {
        await requireThingtimeCapability('api.things-fork', '1.6.0');
        return asyncFetcher.submit({ id: args.id, key: args.key }, { action: '/api/v1/things/fork' });
      }, [asyncFetcher]),
      export: useCallback(async (args: { ids: string[]; key?: string; includeChildren?: boolean; includeDependencies?: boolean; includeFiles?: boolean; includeLinks?: boolean }, options?: { signal?: AbortSignal }) => {
        return withExportDeadline(async signal => {
          await requireThingtimeCapability('api.things-export', '1.17.0');
          if (args.includeFiles !== false) await requireThingtimeCapability('api.attachment-content', '1.11.0');
          signal.throwIfAborted();
          return asyncFetcher.submit(args, { action: '/api/v1/things/export', signal, errorContext: 'export Things' });
        }, options?.signal);
      }, [asyncFetcher]),
      import: useCallback(async (args: { manifest: unknown; files?: Record<string, string>; localFiles?: Map<string, Uint8Array | Blob>; folderId?: string | null }, options?: { signal?: AbortSignal }) => {
        if (args.localFiles !== undefined) throw new Error('Local file bytes require the local workspace importer; they cannot be sent to an account endpoint');
        await requireThingtimeCapability('api.things-import', '1.13.0');
        return asyncFetcher.submit(args, { action: '/api/v1/things/import', signal: options?.signal, errorContext: 'import Things' });
      }, [asyncFetcher]),
      // scope: 'subspaces' narrows the page to posts from the viewer's ACTIVE
      // subspaces (the "🪐 My subspaces" chip); default all
      feed: useCallback(async (args) => {
        await requireThingtimeCapability('api.things-feed', '1.8.0');
        return getJson(`/api/v1/things/feed${toQuery(args)}`);
      }, [getJson]),
      // the explore board — public trending posts; `anon: 1` keeps logged-out
      // requests edge-cacheable, mirroring feed
      trending: useCallback(async (args?: { anon?: 1 }) => getJson(`/api/v1/things/trending${toQuery(args)}`), [getJson]),
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
        async (args, options?: { signal?: AbortSignal; onRefresh?: (result: any) => void; onError?: (error: unknown) => void }) => {
          const { conditions, mode, workspace: _workspace, ...rest } = args || {};
          if (rest.near !== undefined) await requireThingtimeCapability('api.things-search', '1.3.0');
          if (rest.anon && !conditions && rest.near === undefined) {
            return getJson(`/api/v1/things/search${toQuery(rest)}`);
          }
          return asyncFetcher.submit({ ...rest, conditions, mode }, { action: '/api/v1/things/search', signal: options?.signal });
        },
        [asyncFetcher, getJson]
      ),
      userPosts: useCallback(async (args) => {
        await requireThingtimeCapability('api.things-user', '1.7.0');
        await requireThingtimeCapability('api.attachment-content', '1.8.0');
        return getJson(`/api/v1/things/user${toQuery(args)}`);
      }, [getJson]),
			// commentSort: 'top' | 'new' | 'old' re-orders the shipped comment page
			// of the post projection (PostCard's Top / New / Old menu); omit for
			// the default page. key: a hidden thing's secret link key (?key= on
			// /post pages) — lets anyone holding the link view the unlisted thing.
			// sharedRoot scopes a dependency read to an authorized composition.
			get: useCallback(
				async (args, options?: ThingRequestOptions) => {
          const expectedDataPlane = options?.expectedDataPlane === undefined ? planeRef.current : options.expectedDataPlane;
          if (options?.expectedActor) await requireThingtimeCapability('api.actions-run', '1.7.0');
          if (expectedDataPlane) await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
          await requireThingtimeCapability('api.things', args?.sharedRoot ? '1.31.0' : '1.40.0');
          await requireThingtimeCapability('api.attachment-content', '1.9.0');
          return getJson(`/api/v1/things${toQuery({ id: args?.id, commentProjection: args?.commentProjection ? true : undefined, commentSort: args?.commentSort, key: args?.key, sharedRoot: args?.sharedRoot })}`, { ...options, expectedDataPlane });
        },
				[getJson]
			),
      list: useCallback(
        async (args, options?: ThingRequestOptions) => {
          const expectedDataPlane = options?.expectedDataPlane === undefined ? planeRef.current : options.expectedDataPlane;
          if (expectedDataPlane) await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
          if (options?.expectedActor) await requireThingtimeCapability('api.actions-run', '1.7.0');
          await requireThingtimeCapability('api.things', args?.commentProjection ? '1.27.0' : args?.target ? '1.22.0' : args?.folder === 'root' ? '1.39.1' : '1.14.0');
          return getJson(
            `/api/v1/things${toQuery({
              target: args?.target,
              commentProjection: args?.commentProjection ? true : undefined,
              key: args?.key,
              thingtime: args?.thingtime,
              folder: args?.folder,
              cursor: args?.cursor,
              limit: args?.limit,
              // session-auth data browser: narrow own-things to ONE app's namespace
              appId: args?.appId
            })}`, { ...options, expectedDataPlane }
          );
        },
        [getJson]
      ),
      archive: useCallback(async (args: { id: string }, options?: { signal?: AbortSignal }) => {
        await requireThingtimeCapability('api.things', '1.17.0');
        return getJson(`/api/v1/things${toQuery({ id: args.id, archive: true })}`, options);
      }, [getJson]),
      update: useCallback(
        async (args, options?: ThingRequestOptions) => {
          const expectedDataPlane = options?.expectedDataPlane === undefined ? planeRef.current : options.expectedDataPlane;
          const expectedActor = options?.expectedActor ?? args?.expectedActor;
          if (requiresUncappedDataStrings(args?.crystal)) await requireThingtimeCapability('api.things', '1.42.0');
          if (args?.crystal?.configurationVersion !== undefined && args?.crystal?.localRootId !== undefined) await requireThingtimeCapability('api.things', FILE_SYNC_REQUIREMENTS['api.things']);
          if (args?.crystal?.title !== undefined || args?.crystal?.thing?.kind === 'thing-collection') await requireThingtimeCapability('api.things', '1.27.0');
          if (Array.isArray(args?.attachmentIds) && args.attachmentIds.length > 25) await requireThingtimeCapability('api.things', '1.19.0');
          else if (args?.geo !== undefined) await requireThingtimeCapability('api.things', '1.18.0');
          if (Array.isArray(args?.crystal?.steps) && args.crystal.steps.some((step: { op?: string }) => step?.op === 'lookup')) await requireThingtimeCapability('api.things', '1.20.0');
          if (hasLiveSourceBinding(args?.crystal)) await requireThingtimeCapability('api.things', '1.37.0');
          else if (args?.crystal?.source) await requireThingtimeCapability('api.things', '1.30.0');
          if (args?.crystal?.inputs?.some?.((input: { type?: string }) => input?.type === 'json')) await requireThingtimeCapability('api.things-update', '1.10.0');
          if (args?.crystal && browserActionMinimumVersion(args.crystal) === '1.11.0') await requireThingtimeCapability('api.things', '1.32.0');
          else if (args?.crystal?.runtime === 'browser') await requireThingtimeCapability('api.things', browserActionMinimumVersion(args.crystal) === '1.9.0' ? '1.30.0' : browserActionMinimumVersion(args.crystal) === '1.8.0' ? '1.29.0' : '1.28.0');
          if (expectedActor) await requireThingtimeCapability('api.actions-run', '1.7.0');
          options?.signal?.throwIfAborted();
          return asyncFetcher.submit(
            {
              id: args?.id,
              geo: args?.geo,
              crystal: args?.crystal,
              ...(args?.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: args.expectedUpdatedAt } : {}),
              ...(args?.replaceCrystal === true ? { replaceCrystal: true } : {}),
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
            { action: '/api/v1/things', method: 'PATCH', expectedActor, expectedDataPlane, expectedApiOrigin: options?.expectedApiOrigin, signal: options?.signal }
          );
        },
        [asyncFetcher]
      ),
      renameLibrary: useCallback(async (args: { id: string; displayTitle: string; expectedUpdatedAt?: string }) => {
        await requireThingtimeCapability('api.things', '1.27.0');
        return asyncFetcher.submit(args, { action: '/api/v1/things', method: 'PATCH' });
      }, [asyncFetcher]),
      // multi-select move/copy/delete/share — see /docs/api things-bulk
      bulk: useCallback(
        async (args) => {
          if (args?.op === 'move') await requireThingtimeCapability('api.things-bulk', '1.4.0');
          return asyncFetcher.submit(
            {
              op: args?.op,
              ids: args?.ids,
              folderId: args?.folderId ?? null,
              // share op only — omitted entirely for move/copy/delete
              ...(args && 'acl' in args ? { acl: args.acl } : {}),
              ...(args?.recursive ? { recursive: true } : {})
            },
            { action: '/api/v1/things/bulk' }
          );
        },
        [asyncFetcher]
      ),
      upsert: useCallback(
        async (args) => {
          if (requiresUncappedDataStrings(args?.crystal)) await requireThingtimeCapability('api.things', '1.42.0');
          return asyncFetcher.submit(
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
          );
        },
        [asyncFetcher]
      ),
      reactionsRecent: useCallback(async () => getJson('/api/v1/things/reactions-recent'), [getJson]),
      create: useCallback(
        async (args, options?: ThingRequestOptions) => {
          const expectedDataPlane = options?.expectedDataPlane === undefined ? planeRef.current : options.expectedDataPlane;
          const expectedActor = options?.expectedActor ?? args?.expectedActor;
          if (requiresUncappedDataStrings(args?.crystal)) await requireThingtimeCapability('api.things', '1.42.0');
          if (args?.thingtime?.includes('file-sync')) await requireThingtimeCapability('api.things', FILE_SYNC_REQUIREMENTS['api.things']);
          if (args?.thing?.kind === 'thing-collection' || args?.crystal?.thing?.kind === 'thing-collection') await requireThingtimeCapability('api.things', '1.27.0');
					if (Array.isArray(args?.attachmentIds) && args.attachmentIds.length > 25) await requireThingtimeCapability('api.things', '1.19.0');
          else if (args?.geo !== undefined) await requireThingtimeCapability('api.things', '1.18.0');
          if (Array.isArray(args?.crystal?.steps) && args.crystal.steps.some((step: { op?: string }) => step?.op === 'lookup')) await requireThingtimeCapability('api.things', '1.20.0');
          if (hasLiveSourceBinding(args?.crystal)) await requireThingtimeCapability('api.things', '1.37.0');
          else if (args?.crystal?.source) await requireThingtimeCapability('api.things', '1.30.0');
          if (args?.crystal?.inputs?.some?.((input: { type?: string }) => input?.type === 'json')) await requireThingtimeCapability('api.things', '1.33.0');
          if (args?.crystal && browserActionMinimumVersion(args.crystal) === '1.11.0') await requireThingtimeCapability('api.things', '1.32.0');
          else if (args?.crystal?.runtime === 'browser') await requireThingtimeCapability('api.things', browserActionMinimumVersion(args.crystal) === '1.9.0' ? '1.30.0' : browserActionMinimumVersion(args.crystal) === '1.8.0' ? '1.29.0' : '1.28.0');
          if (expectedActor) await requireThingtimeCapability('api.actions-run', '1.7.0');
          const payload = buildThingCreateRequestPayload(args);
					const attachmentIds = args?.attachmentIds;
					const ret = withPostRequestDeadline(signal => asyncFetcher.submit(payload, { action: '/api/v1/things', errorContext: 'publish your post', signal, expectedActor, expectedDataPlane, expectedApiOrigin: options?.expectedApiOrigin }), 30_000, options?.signal);
					if (Array.isArray(attachmentIds) && attachmentIds.length > 0) {
						ret.then(refreshRootData).catch(() => {});
					}
					return ret;
        },
        [asyncFetcher]
      ),
      react: useCallback(
        async (args) => {
          await requireThingtimeCapability('api.things-react', '1.2.0');
          return asyncFetcher.submit({ id: args?.id, emoji: args?.emoji ?? null }, { action: '/api/v1/things/react', errorContext: 'save your reaction' });
        },
        [asyncFetcher]
      ),
      // toggle a private "add to my library" save on any visible thing
      save: useCallback(async (args) => {
        await requireThingtimeCapability('api.things-save', '1.2.0');
        return asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/things/save' });
      }, [asyncFetcher]),
      // the viewer's Saved library — posts they bookmarked, newest-saved-first
      saved: useCallback(async (args?: { cursor?: string; limit?: number }) => getJson(`/api/v1/things/saved${toQuery(args)}`), [getJson]),
      // cast/move/remove the caller's vote on a visible poll thing
      vote: useCallback(
        async (args: { id: string; optionIndex: number }) => {
          await requireThingtimeCapability('api.things-vote', '1.2.0');
          return asyncFetcher.submit({ id: args?.id, optionIndex: args?.optionIndex }, { action: '/api/v1/things/vote', errorContext: 'save your vote' });
        },
        [asyncFetcher]
      ),
      // up/down vote (the separate focused reaction kind): 'up' | 'down' casts
      // or flips, the same direction again clears, null clears
      updown: useCallback(
        async (args: { id: string; direction: 'up' | 'down' | null }) => {
          await requireThingtimeCapability('api.things-updown', '1.2.0');
          return asyncFetcher.submit({ id: args?.id, direction: args?.direction ?? null }, { action: '/api/v1/things/updown', errorContext: 'save your vote' });
        },
        [asyncFetcher]
      ),
      comment: useCallback(
        // simple text comments send { id, text }; rich comments add
				// type/images/listing/thing/mediaLayout/tags/attachments — comments share the post schema
        async (args) => {
          await requireThingtimeCapability('api.things-comment', '1.8.0');
					const attachmentIds = args?.attachmentIds;
					const ret = asyncFetcher.submit(
						buildThingCommentRequestPayload(args),
						{ action: '/api/v1/things/comment', ...(args?.characterId ? { characterId: args.characterId, expectedActor: args.characterId } : {}) }
					);
					if (Array.isArray(attachmentIds) && attachmentIds.length > 0) {
						ret.then(refreshRootData).catch(() => {});
					}
					return ret;
        },
        [asyncFetcher]
      ),
      share: useCallback(
        async (args) => {
          await requireThingtimeCapability('api.things-share', '1.3.0');
          return asyncFetcher.submit(
            // tags: the quote caption's harvested inline #hashtags — merged
            // server-side with the tags carried from the original post
            { id: args?.id, text: args?.text, tags: args?.tags, acl: args?.acl, visibility: args?.visibility },
            { action: '/api/v1/things/share' }
          );
        },
        [asyncFetcher]
      ),
			remove: useCallback(
				async (args) => {
					await requireThingtimeCapability('api.things', '1.12.0');
					const ret = asyncFetcher.submit({ id: args?.id, expectedUpdatedAt: args?.expectedUpdatedAt }, { action: '/api/v1/things', method: 'DELETE' });
					ret.then(refreshRootData).catch(() => {});
					return ret;
				},
				[asyncFetcher]
			)
    },
    // "Login with Thingtime" grants — the user's connected apps
    oauth: {
      grants: useCallback(async () => getJson('/api/v1/oauth/grants'), [getJson]),
      revokeGrant: useCallback(
        async (args) => asyncFetcher.submit({ clientId: args?.clientId }, { action: '/api/v1/oauth/grants/revoke' }),
        [asyncFetcher]
      )
    },
    // third-party app connections (Reddit, YouTube, Mastodon, …) — link
    // external accounts, browse their feeds, manage AI feed filters
    connections: {
      providers: useCallback(async () => getJson('/api/v1/connections/providers'), [getJson]),
      list: useCallback(async () => getJson('/api/v1/connections'), [getJson]),
      connect: useCallback(
        async (args) => asyncFetcher.submit({ provider: args?.provider, fields: args?.fields, expectedOwnerId: args?.expectedOwnerId }, { action: '/api/v1/connections', signal: args?.signal }),
        [asyncFetcher]
      ),
      unlink: useCallback(async (args) => asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/connections/unlink' }), [asyncFetcher]),
      // SSO account linking: begin returns the provider's authorize URL — send
      // the browser there; the callback lands back on /connections
      oauthBegin: useCallback(
        async (args) => asyncFetcher.submit({ provider: args?.provider, expectedOwnerId: args?.expectedOwnerId }, { action: '/api/v1/connections/oauth/begin', signal: args?.signal }),
        [asyncFetcher]
      ),
      // the Thingtime-managed virtual YouTube subscription list
      youtubeSearch: useCallback(async (args) => getJson(`/api/v1/connections/youtube/search${toQuery({ q: args?.q })}`), [getJson]),
      youtubeChannels: useCallback(
        async (args) =>
          asyncFetcher.submit(
            { ...(args && 'add' in args ? { add: args.add } : {}), ...(args?.remove ? { remove: args.remove } : {}) },
            { action: '/api/v1/connections/youtube/channels' }
          ),
        [asyncFetcher]
      ),
      feed: useCallback(
        async (args) =>
          getJson(
            `/api/v1/connections/feed${toQuery({
              connection: args?.connection,
              cursor: args?.cursor,
              limit: args?.limit,
              sync: args?.sync,
              deepen: args?.deepen
            })}`
          ),
        [getJson]
      ),
      filters: useCallback(async () => getJson('/api/v1/connections/filters'), [getJson]),
      saveFilter: useCallback(
        async (args) =>
          asyncFetcher.submit(
            { id: args?.id, name: args?.name, prompt: args?.prompt, action: args?.action, enabled: args?.enabled },
            { action: '/api/v1/connections/filters' }
          ),
        [asyncFetcher]
      ),
      removeFilter: useCallback(
        async (args) => asyncFetcher.submit({ id: args?.id, remove: true }, { action: '/api/v1/connections/filters' }),
        [asyncFetcher]
      )
    },
    // first-party browsing of app namespaces (what has each app stored for me)
    apps: {
      list: useCallback(async () => getJson('/api/v1/apps'), [getJson]),
      storage: useCallback(async (args: { clientId: string }) => getJson(`/api/v1/apps/storage${toQuery({ clientId: args?.clientId })}`), [getJson]),
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
      dataSummary: useCallback(async () => getJson('/api/v1/apps/data-summary'), [getJson]),
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
        [getJson]
      ),
      dataDeleteAll: useCallback(
        async (args) => asyncFetcher.submit({ appId: args?.appId }, { action: '/api/v1/apps/data/delete-all' }),
        [asyncFetcher]
      )
    },
    groups: {
      // audience groups (custom visibility) + the picker's prefill sources
      list: useCallback(async () => getJson('/api/v1/groups'), [getJson]),
      create: useCallback(
        async (args) => asyncFetcher.submit({ name: args?.name, memberIds: args?.memberIds }, { action: '/api/v1/groups' }),
        [asyncFetcher]
      ),
      update: useCallback(
        async (args) =>
          asyncFetcher.submit(
            {
              id: args?.id,
              ...(args && 'name' in args ? { name: args.name } : {}),
              ...(args && 'memberIds' in args ? { memberIds: args.memberIds } : {})
            },
            { action: '/api/v1/groups', method: 'PATCH' }
          ),
        [asyncFetcher]
      ),
      remove: useCallback(
        async (args) => asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/groups', method: 'DELETE' }),
        [asyncFetcher]
      ),
      audienceSources: useCallback(async () => getJson('/api/v1/groups/audience-sources'), [getJson])
    },
    tokens: {
      // personal access tokens (Settings → Token minter) — the mint response
      // carries the token string exactly once
      list: useCallback(async () => getJson('/api/v1/tokens'), [getJson]),
      mint: useCallback(
        async (args) =>
          asyncFetcher.submit(
            {
              name: args?.name,
              scopes: args?.scopes,
              expiresInMs: args?.expiresInMs ?? null,
              maxUses: args?.maxUses ?? null,
              onlyCreatedThings: args?.onlyCreatedThings === true,
              visibility: args?.visibility ?? 'all',
              allowGet: args?.allowGet === true
            },
            { action: '/api/v1/tokens' }
          ),
        [asyncFetcher]
      ),
      revoke: useCallback(async (args) => asyncFetcher.submit({ id: args?.id }, { action: '/api/v1/tokens/revoke' }), [asyncFetcher])
    },
    algorithms: {
      search: useCallback(async (args = {}, options?: { signal?: AbortSignal; expectedActor?: string; expectedDataPlane?: string }) => {
        if (options?.expectedActor) await requireThingtimeCapability('api.algorithms-sync', '1.2.0');
        await requireThingtimeCapability('api.algorithms-search', '1.0.0');
        return getJson(`/api/v1/algorithms/search${toQuery(args)}`, options);
      }, [getJson]),
      list: useCallback(async () => getJson('/api/v1/algorithms'), [getJson]),
      // share-link preview (identity + training size only, never weights)
      getShared: useCallback(
        async (args, options?: { signal?: AbortSignal; expectedActor?: string; expectedDataPlane?: string }) => {
          if (options?.expectedActor) await requireThingtimeCapability('api.algorithms-sync', '1.2.0');
          return getJson(`/api/v1/algorithms/shared?id=${encodeURIComponent(args?.id || '')}`, options);
        },
        [getJson]
      ),
      create: useCallback(
        async (args, options?: { signal?: AbortSignal; expectedActor?: string; expectedDataPlane?: string }) => {
          if (options?.expectedActor) await requireThingtimeCapability('api.algorithms-sync', '1.2.0');
          const { name, emoji, branchFrom, events, description } = args;
          if (description !== undefined) await requireThingtimeCapability('api.algorithms', '1.1.0');
          options?.signal?.throwIfAborted();
          return asyncFetcher.submit({ name, emoji, branchFrom, events, description }, { action: '/api/v1/algorithms', signal: options?.signal, expectedActor: options?.expectedActor, expectedDataPlane: options?.expectedDataPlane });
        },
        [asyncFetcher]
      ),
      update: useCallback(
        async (args, options?: { signal?: AbortSignal; expectedActor?: string; expectedDataPlane?: string }) => {
          if (options?.expectedActor) await requireThingtimeCapability('api.algorithms-sync', '1.2.0');
          if (args?.listed !== undefined || args?.description !== undefined) await requireThingtimeCapability('api.algorithms-update', '1.1.0');
          options?.signal?.throwIfAborted();
          return asyncFetcher.submit({ id: args?.id, name: args?.name, emoji: args?.emoji, shared: args?.shared, listed: args?.listed, description: args?.description }, { action: '/api/v1/algorithms/update', signal: options?.signal, expectedActor: options?.expectedActor, expectedDataPlane: options?.expectedDataPlane });
        },
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
          if (isDefaultAlgorithm(args?.algorithmId)) await requireThingtimeCapability('api.algorithms-active', '1.1.0');
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
      relationships: useCallback(async (args) => getJson(`/api/v1/users/relationships${toQuery(args)}`), [getJson]),
      // paged lists: { username | userId, type: followers|following|friends|requests, limit, before }
      connections: useCallback(async (args) => getJson(`/api/v1/users/connections${toQuery(args)}`), [getJson]),
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
      list: useCallback(async (args?: Record<string, unknown>) => {
        if (args?.history) await requireThingtimeCapability('api.notifications-list', '1.4.0');
        return getJson(`/api/v1/notifications${toQuery(args)}`);
      }, [getJson]),
      markRead: useCallback(
				async (args) => asyncFetcher.submit(args?.all ? { all: true } : { ids: args?.ids }, { action: '/api/v1/notifications/read' }),
        [asyncFetcher]
      ),
      settings: {
        get: useCallback(async () => getJson('/api/v1/notifications/settings'), [getJson]),
				set: useCallback(async (args) => asyncFetcher.submit({ prefs: args?.prefs }, { action: '/api/v1/notifications/settings' }), [asyncFetcher])
      }
    },
    profile: {
      get: useCallback(async (args) => getJson(`/api/v1/users/profile${toQuery(args)}`), [getJson]),
      // day-bucketed viewer-visible thing counts for the profile heatmap ({ username })
      activity: useCallback(async (args) => getJson(`/api/v1/users/activity${toQuery(args)}`), [getJson]),
      // public people search (the /search People rail)
      search: useCallback(async (args) => getJson(`/api/v1/users/search${toQuery(args)}`), [getJson]),
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
						'birthday',
						'hideEmailOnProfile'
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
      list: useCallback(async () => getJson('/api/v1/themes'), [getJson]),
      getShared: useCallback(async (args, options?: ThingRequestOptions) => getJson(`/api/v1/themes/shared?id=${encodeURIComponent(args?.id || '')}`, options), [getJson]),
      // public gallery list (no id → every public theme, newest first). The
      // arg is optional: callers that want the server default call this with
      // no arguments at all.
      listShared: useCallback(
        async (args?: { limit?: number }, options?: ThingRequestOptions) =>
          getJson(`/api/v1/themes/shared${args?.limit ? `?limit=${encodeURIComponent(args.limit)}` : ''}`, options),
        [getJson]
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
      list: useCallback(async () => getJson('/api/v1/schemas'), [getJson]),
      get: useCallback(async (id) => getJson(`/api/v1/schemas${toQuery({ id })}`), [getJson]),
      // paginated UGC schema browsing — { q, sort, cursor, limit, library, mine }
      browse: useCallback(async (args) => getJson(`/api/v1/schemas/browse${toQuery(args)}`), [getJson])
    },
    components: {
      // paginated component browsing — { q, sort, cursor, limit, lib, category, library, mine }
      browse: useCallback(async (args) => getJson(`/api/v1/components/browse${toQuery(args)}`), [getJson])
      // creation rides the unified path: things.create({ thingtime: ['component'], crystal })
    },
    actions: {
      // execute one action inside its capability + budget envelope.
      // The body comes from the shared pure builder rather than an inline key
      // list: `source` is a security control (it narrows server-side
      // resolution to actions the viewer owns — execute.ts ownedOnly), and an
      // inline list silently dropped it, disarming the delegated ttAction
      // path in every browser while the API-level battery stayed green.
      run: useCallback(async (args) => {
        const actor = actionActor.current;
        const principal = actionPrincipal.current;
        const expectedPlane = planeRef.current;
        const origin = window.location.origin;
        await requireThingtimeCapability('api.actions-run', requiresUncappedDataStrings(args) ? '1.39.0' : '1.37.0');
        if (actionActor.current !== actor) throw new Error('The active account changed. Run the action again.');
        const response = await asyncFetcher.submit(buildActionRunBody({ ...args, execution: 'browser' }), { action: '/api/v1/actions/run', expectedActor: actor, expectedDataPlane: expectedPlane });
        const retained = await retainActionOutcomeRecovery(response, actor, expectedPlane, recovery => enqueueActionOutcomeRecovery(origin, recovery, principal && principal !== actor ? principal : undefined));
        if (actionActor.current !== actor) throw new Error('The account changed during the Action request. Check History in the original account before running it again.');
        if (planeRef.current !== expectedPlane) throw new Error('The database changed during the Action request. Check History in the original database before running it again.');
        return finishBrowserAction(retained, createBrowserActionHost(() => actionActor.current));
      }, [asyncFetcher]),
      // your own run records — { action, limit }
      runs: useCallback(async (args) => getJson(`/api/v1/actions/runs${toQuery(args)}`), [getJson])
      // creation rides the unified path: things.create({ thingtime: ['action'], crystal })
    },
    components: {
      // paginated component browsing — { q, sort, cursor, limit, lib, category, library, mine }
      browse: useCallback(async (args) => getJson(`/api/v1/components/browse${toQuery(args)}`), [])
      // creation rides the unified path: things.create({ thingtime: ['component'], crystal })
    },
    actions: {
      // execute one action inside its capability + budget envelope
      run: useCallback(
        async (args) => asyncFetcher.submit({ action: args?.action, inputs: args?.inputs }, { action: '/api/v1/actions/run' }),
        [asyncFetcher]
      ),
      // your own run records — { action, limit }
      runs: useCallback(async (args) => getJson(`/api/v1/actions/runs${toQuery(args)}`), [])
      // creation rides the unified path: things.create({ thingtime: ['action'], crystal })
    },
    waitlist: {
      join: useCallback(async (args) => asyncFetcher.submit({ email: args?.email }, { action: '/api/v1/waitlist' }), [asyncFetcher])
    }
  };

  useEffect(() => {
    if (actionUser?.id && !actionUser.temporary && dataPlane && (!delegated || principalId)) {
      const scope = { kind: 'account' as const, origin: window.location.origin, ownerId: actionUser.id, dataPlane, ...(delegated ? {delegatedBy:principalId} : {}) };
      startAccountWorkspaceSync(scope, { localPlane: view.localPlane });
      if (!delegated) startNotificationHistorySync(scope);
    }
  }, [delegated, principalId, actionUser?.id, actionUser?.temporary, dataPlane, view.localPlane]);
  const workspaceApi = useRef(new WorkspaceApiIdentity<typeof v1>());
  const identity = rootIdentity.read();
  const workspaceKey = JSON.stringify([identity.generation, identity.pending, offlineWorkspace || null,
    actionUser?.id || null, actionUser?.temporary || false, dataPlane || null, view.localPlane || null,
    actionUser?.username, actionUser?.displayName, actionUser?.avatarUrl, delegated, principalId]);
  return { v1: workspaceApi.current.resolve(workspaceKey, v1, remote =>
    delegated ? principalId && actionUser && dataPlane ? accountApi(remote, { id: actionUser.id, username: actionUser.username, displayName: actionUser.displayName, avatarUrl: actionUser.avatarUrl }, dataPlane, view, principalId) : characterApi(remote)
    : offlineWorkspace ? accountApi(remote, { id: offlineWorkspace.ownerId, displayName: 'Offline workspace' }, offlineWorkspace.dataPlane, view)
    : actionUser && !actionUser.temporary && dataPlane ? accountApi(remote, { id: actionUser.id, username: actionUser.username, displayName: actionUser.displayName, avatarUrl: actionUser.avatarUrl }, dataPlane, view)
    : actionUser && !actionUser.temporary ? remote : anonymousApi(remote)) };
}
