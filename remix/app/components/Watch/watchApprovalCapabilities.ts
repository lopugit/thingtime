export const WATCH_CODE_ENTRY_REQUIREMENTS = { 'api.watch-pairing': '1.1.0' } as const;
export const WATCH_QUICK_APPROVAL_REQUIREMENTS = { 'api.watch-pairing': '1.2.0' } as const;

export const supportsWatchApproval = (manifest: any, requirements: Record<string, string>): boolean =>
	Object.entries(requirements).every(([id, minimum]) => {
		const feature = manifest?.features?.[id];
		const version = typeof feature === 'string' ? feature : feature?.version;
		if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return false;
		const [major, minor, patch] = version.split('.').map(Number);
		const [requiredMajor, requiredMinor, requiredPatch] = minimum.split('.').map(Number);
		return major === requiredMajor && (minor > requiredMinor || (minor === requiredMinor && patch >= requiredPatch));
	});
