// A fully equipped Mac advertises 65 capabilities. Keep admission and owner
// projections on the same bounded contract as new native features are added.
export const MAX_DEVICE_CAPABILITIES = 128;

export const safeCapabilities = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_DEVICE_CAPABILITIES) : [];

export const normalizeCapabilities = (value: unknown): string[] | null => {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_DEVICE_CAPABILITIES) return null;
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry !== 'string') return null;
		const capability = entry.trim().slice(0, 100);
		if (!capability || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(capability)) return null;
		if (!out.includes(capability)) out.push(capability);
	}
	return out.sort();
};
