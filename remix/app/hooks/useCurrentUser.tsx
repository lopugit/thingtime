import { useRouteLoaderData } from '@remix-run/react';

export type CurrentUser = {
  id: string;
  ttid: string;
  username: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  createdAt: string;
} | null;

// Reads the authenticated user resolved by the root loader (getCurrentUser).
// Revalidates automatically after login/logout/navigation.
export const useCurrentUser = (): CurrentUser => {
  const data = useRouteLoaderData('root') as { user?: CurrentUser } | undefined;
  return data?.user ?? null;
};
