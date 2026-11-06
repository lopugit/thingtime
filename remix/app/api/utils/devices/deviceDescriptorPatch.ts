export type DeviceDescriptorPatch = { model: string; osVersion?: string; appVersion?: string };
export function normalizeDeviceDescriptorPatch(value: unknown): DeviceDescriptorPatch | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	if (Object.keys(raw).some((k) => !['model', 'osVersion', 'appVersion'].includes(k)) || typeof raw.model !== 'string' || !raw.model.trim())
		return null;
	const out: any = { model: raw.model.trim() };
	for (const key of ['osVersion', 'appVersion'])
		if (raw[key] !== undefined) {
			if (typeof raw[key] !== 'string' || !raw[key].trim()) return null;
			out[key] = raw[key].trim();
		}
	for (const field of Object.values(out)) if (/[\p{Cc}\p{Cf}]/u.test(field as string)) return null;
	return out;
}
