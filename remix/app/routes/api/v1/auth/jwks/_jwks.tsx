import { json } from '~/api/http';

import { getPublicJwks, hasAsymmetricJwtKeys } from '~/api/utils/auth/jwt';

// GET /api/v1/auth/jwks - public ES256 verification keys for external verifiers.
export const loader = async () => {
  if (!hasAsymmetricJwtKeys()) {
    return json({ keys: [] }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  return json(await getPublicJwks(), {
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
};
