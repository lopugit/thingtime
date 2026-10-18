export type MediaExport = { blob: Blob; name: string };
/** Called only after source-window, active-run and declared-media checks. */
export function mediaExport(value: unknown): MediaExport | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object') throw new Error('Invalid media export');
	const { blob, name } = value as MediaExport;
	if (
		!(blob instanceof Blob) ||
		blob.size < 1 ||
		!['video/mp4', 'video/webm'].includes(blob.type) ||
		typeof name !== 'string' ||
		!/^[a-zA-Z0-9 _-]{1,90}\.(mp4|webm)$/.test(name) ||
		!name.endsWith(blob.type === 'video/mp4' ? '.mp4' : '.webm')
	)
		throw new Error('Invalid local media file');
	return { blob, name };
}
