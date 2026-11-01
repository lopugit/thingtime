import { json } from '~/api/http';

import { listLiveSubscriptionTiers } from '~/api/utils/subscriptions/tierCatalogStore';

// Public catalog: only live immutable revisions. Drafts/archives are never
// selectable, though an authenticated assignment response may separately
// include its own archived current revision for historical display.
export const loader = async () => json({ ok: true, tiers: await listLiveSubscriptionTiers() });
