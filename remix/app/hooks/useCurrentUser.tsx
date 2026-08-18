import { useRouteLoaderData } from 'react-router';

export type CurrentUser = {
  id: string;
  ttid: string;
  username: string;
  email: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
	avatarAttachmentId: string | null;
	bannerAttachmentId: string | null;
	avatarLinkedUrl: string | null;
	bannerLinkedUrl: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
	// Beta media-upload gate: false until an admin grants meta.mediaUpload
	// (admins are always true). Optional so cached pre-gate payloads type-check.
	canUploadMedia?: boolean;
  createdAt: string;
  accountKind: 'user' | 'service';
  emailVerificationRequiredBy: string | null;
  temporary?: boolean;
	// Flat aliases are retained for older consumers, but all new UI should read
	// the canonical nested projection so unavailable/reconciling accounting is
	// never mistaken for zero usage or an unlimited allowance.
  storageAllowanceBytes: number | null;
  storageUsedBytes: number | null;
	storageRemainingBytes: number | null;
	storageAccountingReady: boolean;
	storage: {
		usedBytes: number | null;
		allowanceBytes: number | null;
		remainingBytes: number | null;
		overageBytes: number | null;
		status: 'ready' | 'reconciling' | 'unavailable';
		accountingVersion: number | null;
		reconciledAt: string | null;
	};
  activeThemeId: string | null;
  activeFeedAlgorithmId: string | null;
} | null;

// Reads the authenticated user resolved by the root loader (getCurrentUser).
// Revalidates automatically after login/logout/navigation.
export const useCurrentUser = (): CurrentUser => {
  const data = useRouteLoaderData('root') as { user?: CurrentUser } | undefined;
  return data?.user ?? null;
};
