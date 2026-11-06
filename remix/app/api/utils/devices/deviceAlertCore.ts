export type DeviceAlertSound = { kind: 'default' | 'none' } | { kind: 'prepared'; id: string };
export type DeviceNotificationInput = { title: string; message: string; sound: DeviceAlertSound };
export type DeviceMediaInput = { attachmentId: string; versionId?: string };
export type DeviceMediaPrepareInput = DeviceMediaInput & { format: 'notification-sound'; soundId?: string };
export const alertId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9._:-]*$/.test(v);
export const mediaVersion = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const keys = (raw: any, allowed: string[]) =>
	!!raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).every((k) => allowed.includes(k));
export function normalizeNotificationInput(raw: unknown): DeviceNotificationInput | null {
	const r = raw as any;
	if (
		!keys(r, ['title', 'message', 'sound']) ||
		typeof r.title !== 'string' ||
		!r.title.trim() ||
		typeof r.message !== 'string' ||
		!r.message.trim() ||
		!keys(r.sound, ['kind', 'id'])
	)
		return null;
	if (r.sound.kind === 'prepared')
		return mediaVersion(r.sound.id) ? { title: r.title, message: r.message, sound: { kind: 'prepared', id: r.sound.id } } : null;
	if (!['default', 'none'].includes(r.sound.kind) || r.sound.id !== undefined) return null;
	return { title: r.title, message: r.message, sound: { kind: r.sound.kind } };
}
export function normalizeMediaInput(raw: unknown, preparing = false): DeviceMediaInput | DeviceMediaPrepareInput | null {
	const r = raw as any;
	if (
		!keys(r, preparing ? ['attachmentId', 'versionId', 'format', 'soundId'] : ['attachmentId', 'versionId']) ||
		!alertId(r.attachmentId) ||
		(r.versionId !== undefined && !mediaVersion(r.versionId))
	)
		return null;
	if (preparing && (r.format !== 'notification-sound' || (r.soundId !== undefined && !mediaVersion(r.soundId)))) return null;
	return {
		attachmentId: r.attachmentId,
		...(r.versionId ? { versionId: r.versionId } : {}),
		...(preparing ? { format: 'notification-sound' as const, ...(r.soundId ? { soundId: r.soundId } : {}) } : {})
	};
}
export const preparedSoundFilename = (soundId: string) => {
	if (!mediaVersion(soundId)) throw Error('Invalid prepared sound identity');
	return `tt-${soundId}.caf`;
};
