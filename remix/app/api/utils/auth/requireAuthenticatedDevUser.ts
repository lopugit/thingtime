import { json } from '~/api/http';

import { shouldShowDevVerificationLink } from './devVerification';
import { getCurrentUser } from './getCurrentUser';
import { userHasRole } from './users';
import type { PublicUser } from './users';

type AuthenticatedDevUserResult =
  | {
      ok: true;
      user: PublicUser;
    }
  | {
      ok: false;
      response: Response;
    };

type AuthenticatedDevUserOptions = {
  allowedRoles?: string[];
};

const formatAllowedRoles = (roles: string[]) => roles.map((role) => `'${role}'`).join(', ');

export const requireAuthenticatedDevOrRole = async (
  request: Request,
  endpointName = 'This endpoint',
  options: AuthenticatedDevUserOptions = {}
): Promise<AuthenticatedDevUserResult> => {
  const user = await getCurrentUser(request);

  if (!user) {
    return {
      ok: false,
      response: json({ ok: false, error: 'Authentication required' }, { status: 401 })
    };
  }

  const allowedRoles = options.allowedRoles ?? [];
  const hasAllowedRole = allowedRoles.some((role) => userHasRole(user, role));

  if (shouldShowDevVerificationLink() || hasAllowedRole) {
    return { ok: true, user };
  }

  const roleSuffix = allowedRoles.length ? ` or to users with ${formatAllowedRoles(allowedRoles)}` : '';

  return {
    ok: false,
    response: json(
      {
        ok: false,
        error: `${endpointName} is only available in development and preview environments${roleSuffix}`
      },
      { status: 403 }
    )
  };
};

export const requireAuthenticatedDevUser = async (
  request: Request,
  endpointName = 'This endpoint'
): Promise<AuthenticatedDevUserResult> => requireAuthenticatedDevOrRole(request, endpointName);
