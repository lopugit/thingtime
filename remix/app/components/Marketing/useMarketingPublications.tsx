import React from 'react';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { EMPTY_PUBLICATIONS, createVisibility, type MarketingVisibility } from '~/marketing/publishing';

import { useMarketingPublications, usePreviewAsVisitor } from './marketingPublicationsStore';

// Catalog-aware entry point for the marketing routes and components. The
// store itself (fetch, cache, optimistic writes, the preview flag) is the
// catalog-free marketingPublicationsStore.tsx so the drawer can read it from
// the eager bundle; this file adds the resolver that needs the catalog.

export {
	applyMarketingPublicationChanges,
	refreshMarketingPublications,
	setPreviewAsVisitor,
	useMarketingPublications,
	usePreviewAsVisitor,
	type PublicationsSnapshot,
	type PublicationsStatus
} from './marketingPublicationsStore';

/** The one resolver every marketing surface renders through. */
export const useMarketingVisibility = (): MarketingVisibility => {
	const user = useCurrentUser();
	const { publications, status } = useMarketingPublications();
	const [preview] = usePreviewAsVisitor();
	const isAdmin = !!user?.isAdmin;
	// a failed cold fetch fails CLOSED: nothing published (the gate), never a
	// blank surface — the store keeps retrying in the background
	const resolved = publications ?? (status === 'error' ? EMPTY_PUBLICATIONS : null);
	return React.useMemo(() => createVisibility({ publications: resolved, isAdmin, previewAsVisitor: isAdmin && preview }), [resolved, isAdmin, preview]);
};
