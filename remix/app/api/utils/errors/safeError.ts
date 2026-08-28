// User-facing error text without exposing caught exception messages/stacks
// (CodeQL js/stack-trace-exposure). Two tiers:
// - PublicError: an authored, intentionally user-facing message — its
//   publicMessage passes through to HTTP responses verbatim.
// - Everything else: the full error is logged server-side only, and the
//   response gets a summary built from the error's class name + error code
//   (e.g. "MongoServerSelectionError (ECONNREFUSED)"), never err.message.

export class PublicError extends Error {
  readonly publicMessage: string;

  constructor(message: string) {
    super(message);
    this.name = 'PublicError';
    this.publicMessage = message;
  }
}

const SAFE_ERROR_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

const asCodeString = (value: unknown): string | null => {
	const code = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
	return SAFE_ERROR_TOKEN.test(code) ? code : null;
};

const safeErrorName = (value: unknown, fallback: string): string => {
	const name = typeof value === 'string' ? value.trim() : '';
	return SAFE_ERROR_TOKEN.test(name) ? name : fallback;
};

// Mongo server errors carry codeName ("FailedToParse"); node/undici network
// errors carry code on the error or its cause ("ECONNREFUSED").
const errorCode = (err: Error): string | null => {
  const own = err as { codeName?: unknown; code?: unknown; cause?: unknown };
  const direct = asCodeString(own.codeName) ?? asCodeString(own.code);
  if (direct) return direct;
  if (own.cause instanceof Error) {
    return asCodeString((own.cause as { code?: unknown }).code);
  }
  return null;
};

export const safeErrorText = (err: unknown, context: string, fallback = 'Unexpected error'): string => {
  if (err instanceof PublicError) return err.publicMessage;

  console.error(`[${context}]`, err);

  if (err instanceof Error) {
    const code = errorCode(err);
		const name = safeErrorName(err.name, fallback);
    return code ? `${name} (${code})` : name;
  }

  return fallback;
};
