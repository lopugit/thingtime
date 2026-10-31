import type { ServiceKind } from '~/schemas/serviceWorkspace';

// Record-to-record navigation inside the workspace. Opening a related record
// (property → job → visit → time log) remembers where the viewer came from so
// Back returns there instead of dropping them on the section list.
export const MAX_TRAIL = 20;

export const pushTrail = (trail: string[], currentId: string | null, nextId: string): string[] => {
	if (!currentId || currentId === nextId) return trail;
	return [...trail.filter((id) => id !== nextId && id !== currentId), currentId].slice(-MAX_TRAIL);
};

// Pops until it finds a record that still exists (a trail entry may have been
// deleted meanwhile); returns the remaining trail and the record to show.
export const popTrail = (trail: string[], exists: (id: string) => boolean): { trail: string[]; id: string | null } => {
	const next = [...trail];
	while (next.length) {
		const id = next.pop()!;
		if (exists(id)) return { trail: next, id };
	}
	return { trail: next, id: null };
};

// Child records (time/usage logs, sub-jobs, customer↔property links) are
// added from a parent's page; after saving a NEW one the viewer stays on that
// parent instead of landing on the child's own sparse page.
export const serviceParentRecordId = (kind: ServiceKind, values: Record<string, any>, currentId: string | null): string | null => {
	if (kind === 'time' || kind === 'usage') return typeof values.visitId === 'string' && values.visitId ? values.visitId : null;
	if (kind === 'subjob') return typeof values.jobId === 'string' && values.jobId ? values.jobId : null;
	if (kind === 'link') {
		if (currentId && (currentId === values.customerId || currentId === values.addressId)) return currentId;
		return values.addressId || values.customerId || null;
	}
	return null;
};
