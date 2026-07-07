import { json } from '~/api/http';

import { shouldShowDevVerificationLink } from './devVerification';
import { getCurrentUser } from './getCurrentUser';
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

export const requireAuthenticatedDevUser = async (
  request: Request,
  endpointName = 'This endpoint'
): Promise<AuthenticatedDevUserResult> => {
  const user = await getCurrentUser(request);

  if (!user) {
    return {
      ok: false,
      response: json({ ok: false, error: 'Authentication required' }, { status: 401 })
    };
  }

  if (!shouldShowDevVerificationLink()) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: `${endpointName} is only available in development and preview environments`
        },
        { status: 403 }
      )
    };
  }

  return { ok: true, user };
};
