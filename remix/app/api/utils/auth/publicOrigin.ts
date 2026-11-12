const firstForwardedValue = (value: string | null) => value?.split(',')[0]?.trim() || '';

// The BROWSER-facing URL of a request. Behind a proxy — the Vite dev proxy
// (changeOrigin rewrites Host to the nitro port), a Tailscale funnel, or the
// platform edge — request.url carries the internal target host, while
// x-forwarded-host/-proto carry what the browser actually sees. WebAuthn
// ceremonies must bind to the browser's origin (clientDataJSON.origin and the
// rpID hash are produced there), and cross-deployment hint pointers label
// deployments by their public origin, so both resolve through this. Forged
// forwarded headers only mis-derive the FORGER's own request: WebAuthn
// verification still compares against what the real browser signed, and a
// mismatched cookie Domain is refused by the browser itself (same trust
// stance as isSameOriginPost in auth/temporary).
export const resolvePublicOrigin = (request: Request): URL => {
	const requestUrl = new URL(request.url);
	const forwardedHost = firstForwardedValue(request.headers.get('x-forwarded-host'));
	if (!forwardedHost) return requestUrl;
	const forwardedProto = firstForwardedValue(request.headers.get('x-forwarded-proto'));
	const protocol = forwardedProto ? `${forwardedProto.replace(/:$/, '')}:` : requestUrl.protocol;
	try {
		return new URL(`${protocol}//${forwardedHost}`);
	} catch {
		return requestUrl;
	}
};
