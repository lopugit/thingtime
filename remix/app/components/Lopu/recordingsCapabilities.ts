export const RECORDING_AUTOMATION_REQUIREMENTS = { 'api.lopu-recordings': '1.0.0' } as const;

export const supportsRecordingAutomation = (manifest: any, origin: string) => {
	if (manifest?.origin !== origin) return false;
	return Object.entries(RECORDING_AUTOMATION_REQUIREMENTS).every(([id, minimum]) => {
		const value = manifest.features?.[id];
		const version = typeof value === 'string' ? value : value?.version;
		if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return false;
		const [major, minor, patch] = version.split('.').map(Number);
		const [requiredMajor, requiredMinor, requiredPatch] = minimum.split('.').map(Number);
		return major === requiredMajor && (minor > requiredMinor || (minor === requiredMinor && patch >= requiredPatch));
	});
};
