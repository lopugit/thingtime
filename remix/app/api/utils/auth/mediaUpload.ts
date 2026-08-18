// Media-upload grant. During the beta, uploading media/files requires a
// per-user permission granted manually by an admin: user doc
// `meta.mediaUpload === true` (things-era root boolean `secureMediaUpload`,
// reconstructed into meta by userThingToDoc — mirroring `meta.admin` /
// `secureAdmin`). Admins can always upload. Pure predicate (mirrors
// auth/admin.ts) so it stays clear of the users ↔ getCurrentUser import
// cycle; routes gate on the `canUploadMedia` flag that toPublicUser stamps
// onto every PublicUser.
import { isAdminDoc } from './admin';

export const canUploadMediaDoc = (user: { username?: string; meta?: Record<string, any> } | null | undefined): boolean =>
	!!user && (user.meta?.mediaUpload === true || isAdminDoc(user));
