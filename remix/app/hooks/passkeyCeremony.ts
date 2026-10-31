import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON
} from '@simplewebauthn/browser';

const decode = (value: string): ArrayBuffer => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)).buffer;
const encode = (value: ArrayBuffer): string =>
	btoa(Array.from(new Uint8Array(value), (b) => String.fromCharCode(b)).join(''))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
const descriptor = (value: { id: string; type: 'public-key'; transports?: string[] }): PublicKeyCredentialDescriptor => ({
	...value,
	id: decode(value.id),
	transports: value.transports as AuthenticatorTransport[] | undefined
});

// Use a caller-owned AbortSignal. The library's global abort singleton lets an
// old component cleanup cancel another surface's new ceremony, and doesn't
// cover the options fetch. Explicit byte codecs also work on older Safari.
export const authenticatePasskey = async (
	options: PublicKeyCredentialRequestOptionsJSON,
	signal: AbortSignal,
	conditional: boolean
): Promise<AuthenticationResponseJSON> => {
	const credential = (await navigator.credentials.get({
		publicKey: { ...options, challenge: decode(options.challenge), allowCredentials: conditional ? [] : options.allowCredentials?.map(descriptor) },
		mediation: conditional ? 'conditional' : 'optional',
		signal
	})) as PublicKeyCredential | null;
	if (!credential) throw new DOMException('No passkey was selected', 'NotAllowedError');
	const response = credential.response as AuthenticatorAssertionResponse;
	return {
		id: credential.id,
		rawId: encode(credential.rawId),
		type: 'public-key',
		response: {
			clientDataJSON: encode(response.clientDataJSON),
			authenticatorData: encode(response.authenticatorData),
			signature: encode(response.signature),
			...(response.userHandle ? { userHandle: encode(response.userHandle) } : {})
		},
		clientExtensionResults: credential.getClientExtensionResults(),
		...(credential.authenticatorAttachment ? { authenticatorAttachment: credential.authenticatorAttachment as 'platform' | 'cross-platform' } : {})
	};
};

export const createPasskey = async (options: PublicKeyCredentialCreationOptionsJSON, signal: AbortSignal): Promise<RegistrationResponseJSON> => {
	const credential = (await navigator.credentials.create({
		publicKey: {
			...options,
			challenge: decode(options.challenge),
			user: { ...options.user, id: decode(options.user.id) },
			excludeCredentials: options.excludeCredentials?.map(descriptor)
		},
		signal
	})) as PublicKeyCredential | null;
	if (!credential) throw new DOMException('No passkey was created', 'NotAllowedError');
	const response = credential.response as AuthenticatorAttestationResponse;
	return {
		id: credential.id,
		rawId: encode(credential.rawId),
		type: 'public-key',
		response: {
			clientDataJSON: encode(response.clientDataJSON),
			attestationObject: encode(response.attestationObject),
			transports: response.getTransports?.() as RegistrationResponseJSON['response']['transports']
		},
		clientExtensionResults: credential.getClientExtensionResults(),
		...(credential.authenticatorAttachment ? { authenticatorAttachment: credential.authenticatorAttachment as 'platform' | 'cross-platform' } : {})
	};
};

// One foreground request per document. A delayed autofill support probe must
// never supersede a click. Cancellation spans options, native UI and verify.
export class PasskeyCeremonies {
	private readonly timeoutMs: number;
	constructor(timeoutMs = 120_000) {
		this.timeoutMs = timeoutMs;
	}
	private active: { owner: object; controller: AbortController; conditional: boolean } | null = null;
	async run<T>(owner: object, conditional: boolean, work: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
		if (external?.aborted || (this.active && (!this.active.conditional || conditional))) {
			throw new DOMException('Another passkey request is active', 'AbortError');
		}
		this.active?.controller.abort();
		const current = { owner, conditional, controller: new AbortController() };
		this.active = current;
		const abort = () => current.controller.abort();
		external?.addEventListener('abort', abort, { once: true });
		let rejectAbort!: () => void;
		const aborted = new Promise<never>((_, reject) => {
			rejectAbort = () => reject(current.controller.signal.reason);
			current.controller.signal.addEventListener('abort', rejectAbort, { once: true });
		});
		const timeout = conditional ? undefined : setTimeout(() => current.controller.abort(new DOMException('Passkey request timed out', 'TimeoutError')), this.timeoutMs);
		try {
			// Extensions may ignore AbortSignal and never settle credentials.get.
			// Release our UI anyway; each subsequent stage still checks the signal.
			return await Promise.race([work(current.controller.signal), aborted]);
		} finally {
			clearTimeout(timeout);
			current.controller.signal.removeEventListener('abort', rejectAbort);
			external?.removeEventListener('abort', abort);
			if (this.active === current) this.active = null;
		}
	}
	cancel(owner: object) {
		if (this.active?.owner === owner) {
			this.active.controller.abort();
			this.active = null;
		}
	}
}
export const passkeyCeremonies = new PasskeyCeremonies();

export const passkeyErrorMessage = (error: any): string => {
	if (error?.name === 'TimeoutError') return 'The passkey provider did not respond. Try again, or use your password.';
	if (error?.name === 'SecurityError' || error?.code === 'ERROR_INVALID_RP_ID')
		return 'This app or address cannot use this passkey. Open the same Thingtime address in Safari or Chrome and try again.';
	if (error?.name === 'InvalidStateError')
		return 'A passkey for this account is already saved with that provider. Choose another provider, or use the existing passkey.';
	if (error?.name === 'NotSupportedError') return 'This browser or device cannot use this passkey. Try Safari, Chrome, or another passkey provider.';
	if (error?.name === 'NotAllowedError')
		return 'No passkey was returned. Try again and choose the account saved for this environment, or use your password.';
	return error?.error || 'The passkey request failed. Try again, or use your password.';
};
