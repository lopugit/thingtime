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
  // private: own-account responses only, never the public profile
  birthday: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
  createdAt: string;
  accountKind: 'user' | 'service';
  emailVerificationRequiredBy: string | null;
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
