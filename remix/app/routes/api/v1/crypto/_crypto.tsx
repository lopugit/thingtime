import { json } from '~/api/http';

import {
  CRYPTO_STANDARDS,
  generateCryptoKeyPair,
  matchKeyPairInput,
  verifyJwtInput,
  verifySignedMessageInput
} from '~/api/utils/crypto/cryptoTools.server';
import { safeErrorText } from '~/api/utils/errors/safeError';

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

    return json({ ok: false, error: 'Unknown crypto action.' }, { status: 400 });
  } catch (err) {
    return json({ ok: false, error: safeErrorText(err, 'crypto action', 'Crypto action failed') }, { status: 400 });
  }
};
