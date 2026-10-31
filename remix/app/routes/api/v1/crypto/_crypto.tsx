import { json } from '~/api/http';

import {
  CRYPTO_STANDARDS,
  generateCryptoKeyPair,
  matchKeyPairInput,
  verifyJwtInput,
  verifySignedMessageInput
} from '~/api/utils/crypto/cryptoTools.server';
import { hashPasswordForStorage } from '~/api/utils/crypto/passwordHasher.server';
import { safeErrorText } from '~/api/utils/errors/safeError';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const loader = async () => {
  return json({
    ok: true,
    standards: Object.entries(CRYPTO_STANDARDS).map(([value, config]) => ({
      value,
      label: config.label,
      thingtimeAuthCompatible: value === 'ES256'
    }))
  });
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const body = await request.json();
    const intent = String(body?.intent || '');

    if (intent === 'generate-key-pair') {
      return json({ ok: true, result: generateCryptoKeyPair(body) });
    }

    if (intent === 'verify-jwt') {
      return json({ ok: true, result: await verifyJwtInput(body) });
    }

    if (intent === 'verify-signature') {
      return json({ ok: true, result: verifySignedMessageInput(body) });
    }

    if (intent === 'match-key-pair') {
      return json({ ok: true, result: matchKeyPairInput(body) });
    }

    // Password hasher — anonymous by design (being locked out is the reason to
    // reach for it) and pure (no DB access), but bcrypt is deliberately slow,
    // so it gets its own tight per-IP budget: the CPU cost is the abuse
    // surface, not the output.
    if (intent === 'hash-password') {
      const limit = await enforceRateLimit(request, 'crypto.hashPassword', null);
      if (!limit.allowed) {
        return json(
          { ok: false, error: 'Hashing is CPU-heavy — take a breather 🌸' },
          rateLimitedResponseInit(limit)
        );
      }
      return json({ ok: true, result: await hashPasswordForStorage(body) });
    }

    return json({ ok: false, error: 'Unknown crypto action.' }, { status: 400 });
  } catch (err) {
    return json({ ok: false, error: safeErrorText(err, 'crypto action', 'Crypto action failed') }, { status: 400 });
  }
};
