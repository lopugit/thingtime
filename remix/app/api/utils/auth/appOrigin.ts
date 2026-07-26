// Trusted origin for links we email to users (verification, password reset).
//
// These links carry single-use auth tokens. If the origin were taken from the
// request Host header, an attacker could POST a reset request with
// `Host: attacker.com` and the victim would receive a real email whose link
// points at the attacker — clicking it leaks the token (account takeover for
// password reset). So we prefer the server-configured APP_URL and only fall
// back to the request origin when APP_URL is unset (local dev / preview, where
// the host is trusted and APP_URL often isn't configured).
export const resolveTrustedOrigin = (request: Request): string => {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(request.url).origin;
};
