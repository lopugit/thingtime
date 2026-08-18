// Media-upload permission. Two beta gates landed in parallel (this branch's
// meta.mediaUpload and PR #301's meta.publicUploads hotfix, now on main);
// they are consolidated on #301's storage: tri-state `meta.publicUploads`
// (absent = account predates the gate, grandfathered enabled; false =
// withheld at signup; true = granted by an admin from /admin). Admins always
// pass. This predicate is THE single source both PublicUser flags
// (`canUploadMedia`, `publicUploadsEnabled`) and both upload-gate branches
// read, so one admin toggle fully unblocks an account. Pure predicate
// (mirrors auth/admin.ts) to stay clear of the users ↔ getCurrentUser
// import cycle.
import { isAdminDoc } from './admin';

export const canUploadMediaDoc = (user: { username?: string; meta?: Record<string, any> } | null | undefined): boolean =>
	!!user && (isAdminDoc(user) || user.meta?.publicUploads !== false);
