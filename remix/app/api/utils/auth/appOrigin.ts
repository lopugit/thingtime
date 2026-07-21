// Trusted origin for links we email to users (verification, password reset).
//
// These links carry single-use auth tokens. If the origin were taken from the
// request Host header, an attacker could POST a reset request with
// `Host: attacker.com` and the victim would receive a real email whose link
// points at the attacker — clicking it leaks the token (account takeover for
// password reset). So we prefer the server-configured APP_URL, and the
// fallback (local dev / preview, where APP_URL often isn't configured) only
// trusts hosts we actually deploy to — anything else gets the canonical
// production origin instead of the caller-controlled Host header.
const CANONICAL_ORIGIN = 'https://thingtime.com';

const TRUSTED_FALLBACK_HOST_PATTERN =
  /^(localhost|127\.0\.0\.1|(?:[\w-]+\.)*thingtime\.com|[\w-]+\.vercel\.app|(?:[\w-]+\.)+ts\.net)$/i;

export const resolveTrustedOrigin = (request: Request): string => {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const requestUrl = new URL(request.url);
  if (TRUSTED_FALLBACK_HOST_PATTERN.test(requestUrl.hostname)) {
    return requestUrl.origin;
  }

  return CANONICAL_ORIGIN;
};
