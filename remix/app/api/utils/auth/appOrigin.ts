// Trusted origin for links we email to users (verification, password reset).
//
// These links carry single-use auth tokens. If the origin were taken from the
// request Host header, an attacker could POST a reset request with
// `Host: attacker.com` and the victim would receive a real email whose link
// points at the attacker — clicking it leaks the token (account takeover for
// password reset). So the resolution order is: server-configured APP_URL, then
// the hostname the PLATFORM tells us we are (Vercel env, not caller-supplied),
// then — only when nothing server-side names this deployment, i.e. local dev —
// a narrow Host allowlist, and finally the canonical production origin.
const CANONICAL_ORIGIN = 'https://thingtime.com';

// Host values we accept from the request itself. Deliberately does NOT include
// `*.vercel.app`: that namespace is multi-tenant, anyone can deploy
// `attacker-xyz.vercel.app`, and trusting it would re-open the exact spoof this
// module exists to close. Vercel deployments are named by the env branch below
// instead, so they never need the Host header. `*.ts.net` (Tailscale) is
// likewise tenant-chosen, so it is only reachable on a non-Vercel runtime — a
// developer's own machine — where the Host is not attacker-supplied.
const TRUSTED_FALLBACK_HOST_PATTERN =
  /^(localhost|127\.0\.0\.1|\[::1\]|(?:[\w-]+\.)*thingtime\.com|(?:[\w-]+\.)+ts\.net)$/i;

const toOrigin = (value: string | undefined): string | undefined => {
  const host = value?.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return host ? `https://${host}` : undefined;
};

// Vercel injects these at build and runtime. They name THIS deployment and are
// not caller-controlled, so on Vercel they always beat the Host header.
// Production prefers the project's production domain; preview prefers the
// stable per-branch URL over the immutable per-deployment one, so an emailed
// link still resolves after the next push to that branch.
const vercelDeploymentOrigin = (): string | undefined => {
  const branchUrl = process.env.VERCEL_BRANCH_URL;
  const deploymentUrl = process.env.VERCEL_URL;
  if (!branchUrl && !deploymentUrl) return undefined;

  const environment = process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV;
  if (environment === 'production') {
    return (
      toOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
      toOrigin(branchUrl) ||
      toOrigin(deploymentUrl)
    );
  }

  return toOrigin(branchUrl) || toOrigin(deploymentUrl);
};

export const resolveTrustedOrigin = (request: Request): string => {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  // On Vercel the platform names us, so the Host header is never consulted.
  const fromPlatform = vercelDeploymentOrigin();
  if (fromPlatform) return fromPlatform;

  const requestUrl = new URL(request.url);
  if (TRUSTED_FALLBACK_HOST_PATTERN.test(requestUrl.hostname)) {
    return requestUrl.origin;
  }

  return CANONICAL_ORIGIN;
};
