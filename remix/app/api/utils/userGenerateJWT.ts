import { randomUUID } from 'node:crypto';

// query mongodb for user objects with the username provided
// if user exists, return true
// if user does not exist, return false

export const userGenerateJWT = async ({ username, password }) => {
  // Token ids must be unguessable: `Math.random()` is not a CSPRNG, and this
  // stub is what `FUNDAMENTALS.md` §5 still names as the JWT minting path, so
  // the seed here matches the live session layer (`auth/sessions.ts` jti).
  const uuid = randomUUID();

  const jwt = {};
};
