// "Can this account upload ANYTHING?" — the any-scope alias over the scoped
// upload permissions (PR #310: tri-state `meta.publicUploads` for
// post/comment/custom-emoji, `meta.privateUploads` for messages + own profile
// media; absent = grandfathered pre-gate account, false = withheld at signup,
// true = admin-granted; admins always pass). The purpose-aware upload gate
// lives in attachmentResponses (requireUploadPermission) and reads the
// per-scope flags — this predicate only powers PublicUser.canUploadMedia, the
// composer's approval-pending card fallback, and any other "may upload at
// least one scope" surface. privateUploads is compared with === true (not
// !== false) so a pre-scope account stamped only { publicUploads: false }
// stays fully withheld; grandfathered accounts pass via the public term.
// Pure predicate (mirrors auth/admin.ts) to stay clear of the
// users ↔ getCurrentUser import cycle.
import { isAdminDoc } from './admin';

export const canUploadMediaDoc = (user: { username?: string; meta?: Record<string, any> } | null | undefined): boolean =>
	!!user && (isAdminDoc(user) || user.meta?.publicUploads !== false || user.meta?.privateUploads === true);
