import { sha256 } from '@noble/hashes/sha2.js';
import { draftRequest } from './draftClient';
import { workspaceScopeKey, type WorkspaceScope, type WorkspaceLease } from '../local-workspace/storage';

/** Schema editor recovery is portable content, but automatic resume must stay
 * in its originating account/origin/data plane. Never adopt a previous lease. */
export function workspaceDraftContextSync(scope: WorkspaceScope, context: string) {
 const digest = sha256(new TextEncoder().encode(workspaceScopeKey(scope)));
 return `${context}:workspace:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
// Keep the asynchronous caller contract while using exactly the same portable
// identity during the first editor render, before any input or recovery effect.
export async function workspaceDraftContext(scope: WorkspaceScope, context: string) {
 return workspaceDraftContextSync(scope, context);
}
export function workspaceDraftRequest(lease: WorkspaceLease, request = draftRequest): typeof draftRequest {
 return async (...args) => { lease.assertCurrent(); const result = await request(...args); lease.assertCurrent(); return result as any; };
}

/** Recovery identities survive reloads, but never cross owners or data planes.
 * Generation belongs to the lease, not the durable key. */
export function workspaceDraftRecoveryKey(origin: string, actor: string, context: string, scope: WorkspaceScope) {
 return `tt-account-draft:${origin}:${actor}:${context}:workspace-store:${workspaceScopeKey(scope)}`;
}
