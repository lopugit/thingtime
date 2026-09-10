export const RECORDING_AUTOMATION_REQUIREMENTS = { 'api.lopu-recordings': '1.3.0' } as const;
export const PERSONAL_RECORDING_SETTINGS_REQUIREMENTS = { 'api.lopu-recordings': '1.4.0', 'api.lopu-recordings-personal': '1.0.0' } as const;

const supports = (manifest: any, origin: string, requirements: Record<string, string>) => {
	if (manifest?.origin !== origin) return false;
	return Object.entries(requirements).every(([id, minimum]) => {
		const value = manifest.features?.[id];
		const version = typeof value === 'string' ? value : value?.version;
		if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return false;
		const [major, minor, patch] = version.split('.').map(Number);
		const [requiredMajor, requiredMinor, requiredPatch] = minimum.split('.').map(Number);
		return major === requiredMajor && (minor > requiredMinor || (minor === requiredMinor && patch >= requiredPatch));
	});
};
export const supportsRecordingAutomation = (manifest: any, origin: string) => supports(manifest, origin, RECORDING_AUTOMATION_REQUIREMENTS);
export const supportsPersonalRecordingSettings = (manifest: any, origin: string) => supports(manifest, origin, PERSONAL_RECORDING_SETTINGS_REQUIREMENTS);
