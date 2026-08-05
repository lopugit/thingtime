import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import {
  archiveSubscriptionTierVersion,
  createSubscriptionTierDraft,
  createSubscriptionTierDraftVersion,
  listSubscriptionTierVersions,
  publishSubscriptionTierDraft,
  updateSubscriptionTierDraft
} from '~/api/utils/subscriptions/tierCatalogStore';

const groupedCatalog = async () => {
  const tiers = await listSubscriptionTierVersions();
  return {
    tiers,
    live: tiers.filter((tier) => tier.status === 'live'),
    drafts: tiers.filter((tier) => tier.status === 'draft'),
    archived: tiers.filter((tier) => tier.status === 'archived')
  };
};

// GET /api/v1/admin/tiers — every immutable catalog revision, grouped for the
// Live / Draft / Archived admin sections.
export const loader = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
  return json({ ok: true, ...(await groupedCatalog()) });
};

// POST /api/v1/admin/tiers — all lifecycle mutations stay admin-gated and
// explicit. Live/archived records can only be cloned; only drafts are editable.
export const action = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body = await readJsonBody(request, 512 * 1024);
  let result;
  if (body?.action === 'create') {
    result = await createSubscriptionTierDraft(body?.tier ?? {}, gate.user.id);
  } else if (body?.action === 'update-draft') {
    result = await updateSubscriptionTierDraft(body?.versionId, body?.tier ?? {}, gate.user.id);
  } else if (body?.action === 'create-version') {
    result = await createSubscriptionTierDraftVersion(body?.versionId, gate.user.id);
  } else if (body?.action === 'publish') {
    result = await publishSubscriptionTierDraft(body?.versionId, gate.user.id);
  } else if (body?.action === 'archive') {
    result = await archiveSubscriptionTierVersion(body?.versionId, gate.user.id);
  } else {
    return json({ ok: false, error: 'Unknown tier-management action' }, { status: 400 });
  }

  if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
  return json({ ok: true, tier: result.tier, ...(await groupedCatalog()) });
};
