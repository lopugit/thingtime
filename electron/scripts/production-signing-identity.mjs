const developerIdPrefix = 'Developer ID Application:';

/** Keep codesign's full identity separate from electron-builder's qualifier. */
export function productionSigningIdentity(keychainOutput, requested = '') {
	const identities = [...keychainOutput.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
	const identity = requested || identities.find((value) => value.startsWith(developerIdPrefix));
	if (!identity || !identity.startsWith(developerIdPrefix) || !identities.includes(identity)) {
		throw new Error(
			'Production release is blocked: import a Developer ID Application identity into the build keychain and set THINGTIME_ELECTRON_SIGNING_IDENTITY.'
		);
	}
	// electron-builder 26 rejects certificate-type prefixes and chooses the
	// Developer ID certificate type itself for direct macOS distribution.
	const qualifier = identity.slice(developerIdPrefix.length).trim();
	if (!qualifier) throw new Error('The Developer ID Application identity has no certificate name.');
	return { identity, qualifier };
}
