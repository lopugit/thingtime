import { useRouteLoaderData } from 'react-router';

export type CurrentUser = {
  id: string;
  ttid: string;
  username: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  createdAt: string;
  accountKind: 'user' | 'service';
  emailVerificationRequiredBy: string | null;
  storageAllowanceBytes: number | null;
  storageUsedBytes: number | null;
  activeThemeId: string | null;
} | null;

// Reads the authenticated user resolved by the root loader (getCurrentUser).
// Revalidates automatically after login/logout/navigation.
export const useCurrentUser = (): CurrentUser => {
  const data = useRouteLoaderData('root') as { user?: CurrentUser } | undefined;
  return data?.user ?? null;
};
