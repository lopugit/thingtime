import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
export const PASSKEY_REQUIREMENTS = {
	login: { 'api.auth-passkeys-login-options': '1.1.0', 'api.auth-passkeys-login': '1.1.0' },
	registration: { 'api.auth-passkeys-register-options': '1.1.0', 'api.auth-passkeys-register': '1.1.0' }
} as const;
export const supportsPasskeyCeremonies = (manifest: any, origin: string, kind: keyof typeof PASSKEY_REQUIREMENTS) =>
	manifest?.origin === origin &&
	Object.entries(PASSKEY_REQUIREMENTS[kind]).every(([feature, minimum]) => capabilitySatisfies(manifest.features?.[feature]?.version || '', minimum));
let cached: { origin: string; until: number; manifest: any } | undefined;
export const ensurePasskeyCapabilities = async (kind: keyof typeof PASSKEY_REQUIREMENTS, signal: AbortSignal) => {
	const origin = window.location.origin;
	let manifest = cached?.origin === origin && cached.until > Date.now() ? cached.manifest : null;
	if (!manifest) {
		const response = await fetch('/.well-known/thingtime-capabilities.json', { signal, credentials: 'same-origin', cache: 'no-store' });
		if (!response.ok) throw { error: 'Could not check passkey support. Try again in a moment.' };
		manifest = await response.json();
		cached = { origin, until: Date.now() + 60_000, manifest };
	}
	if (!supportsPasskeyCeremonies(manifest, origin, kind))
		throw { error: 'This deployment needs the passkey update. Refresh after it deploys, or use your password.' };
};
