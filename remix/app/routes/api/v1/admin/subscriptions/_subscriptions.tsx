import { json, readJsonBody } from '~/api/http';

import { findAppByClientId } from '~/api/utils/apps/apps';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { findUserById } from '~/api/utils/auth/users';
import { clearSubscription, getSubscription, setSubscription } from '~/api/utils/subscriptions/subscriptions';
import { getSubscriptionTierVersion, listLiveSubscriptionTiers } from '~/api/utils/subscriptions/tierCatalogStore';

const parseSubject = (
  subjectType: unknown,
  subjectId: unknown
): { ok: true; subjectType: 'user' | 'app'; subjectId: string } | { ok: false; error: string } => {
  if (subjectType !== 'user' && subjectType !== 'app') {
    return { ok: false, error: "subjectType must be 'user' or 'app'" };
  }
  const id = typeof subjectId === 'string' ? subjectId.trim() : '';
  if (!id) return { ok: false, error: 'subjectId is required' };
  return { ok: true, subjectType, subjectId: id };
};

// Resolve the affected user (the doc's ownerId): the subject itself for
// users, the app's registering owner for apps — validating the subject exists.
const resolveSubjectOwner = async (
  subjectType: 'user' | 'app',
  subjectId: string
): Promise<{ ok: true; ownerId: string } | { ok: false; status: number; error: string }> => {
  if (subjectType === 'user') {
    const user = await findUserById(subjectId);
    if (!user) return { ok: false, status: 404, error: 'User not found' };
    return { ok: true, ownerId: subjectId };
  }
  const app = await findAppByClientId(subjectId);
  if (!app) return { ok: false, status: 404, error: 'App not found' };
  return { ok: true, ownerId: String(app.ownerId) };
};

// GET /api/v1/admin/subscriptions?subjectType=&subjectId= — one subject's
// assignment (implicit free when none) plus the full tier catalog.
export const loader = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const url = new URL(request.url);
  const subject = parseSubject(url.searchParams.get('subjectType'), url.searchParams.get('subjectId'));
  const catalog = await listLiveSubscriptionTiers();
  if (subject.ok === false) {
    // No subject → just the catalog (the editor's tier picker).
    return json({ ok: true, catalog });
  }

  const subscription = await getSubscription(subject.subjectType, subject.subjectId);
  const assigned = await getSubscriptionTierVersion(subscription.tierVersionId);
  const visibleCatalog = assigned && !catalog.some((tier) => tier.versionId === assigned.versionId) ? [...catalog, assigned] : catalog;
  return json({ ok: true, subscription, catalog: visibleCatalog });
};

// POST /api/v1/admin/subscriptions — assign a tier (+ optional per-field
// admin overrides) to a user or app, or reset with { clear: true }.
export const action = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body = await readJsonBody(request, 16 * 1024);
  const subject = parseSubject(body?.subjectType, body?.subjectId);
  if (subject.ok === false) return json({ ok: false, error: subject.error }, { status: 400 });

  const owner = await resolveSubjectOwner(subject.subjectType, subject.subjectId);
  if (owner.ok === false) return json({ ok: false, error: owner.error }, { status: owner.status });

  if (body?.clear === true) {
    const cleared = await clearSubscription(subject.subjectType, subject.subjectId, gate.user.id);
    if (cleared.ok === false) return json({ ok: false, error: cleared.error }, { status: cleared.status });
    return json({ ok: true, subscription: await getSubscription(subject.subjectType, subject.subjectId) });
  }

  const result = await setSubscription({
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    ownerId: owner.ownerId,
    tier: body?.tier,
    tierVersionId: body?.tierVersionId,
    overrides: body?.overrides,
    note: body?.note,
    updatedBy: gate.user.id
  });
  if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
  return json({ ok: true, subscription: result.subscription });
};
