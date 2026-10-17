import { draftRequest } from './draftClient';
import type { WorkspaceLease } from '../local-workspace/storage';

/** One menu owns one retry identity. Account/plane changes and unmounts retire
 * the callback; a late result cannot notify or start a copy in another editor. */
export function createPostTemplateSession(actor: string, postId: string, lease: WorkspaceLease,
 request = draftRequest, uuid: () => string = () => crypto.randomUUID()) {
 let active = true, id: string | null = null, pending: Promise<void> | null = null;
 const assertCurrent = () => { if (!active) throw Error('The post menu changed. Reopen it before saving a template.'); lease.assertCurrent(); };
 return {
  isCurrent() { try { assertCurrent(); return true; } catch { return false; } },
  dispose() { active = false; },
  save(): Promise<void> {
   try { assertCurrent(); } catch (error) { return Promise.reject(error); }
   if (pending) return pending;
   id ||= uuid();
   pending = (async () => {
    await request(actor, { operation: 'from-post', postId, id });
    assertCurrent(); id = null;
   })().finally(() => { pending = null; });
   return pending;
  }
 };
}
