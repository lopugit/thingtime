export type MediaExport = { blob: Blob; name: string };
export const mediaExtensions: Record<string, string> = {
	'video/mp4': 'mp4', 'video/webm': 'webm', 'image/jpeg': 'jpg',
	'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif'
};
/** Called only after source-window, active-run and declared-media checks. */
export function mediaExport(value: unknown): MediaExport | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object') throw new Error('Invalid media export');
	const { blob, name } = value as MediaExport;
	if (
		!(blob instanceof Blob) ||
		blob.size < 1 ||
		!Object.prototype.hasOwnProperty.call(mediaExtensions, blob.type) ||
		typeof name !== 'string' ||
		!/^[a-zA-Z0-9 _-]{1,90}\.(mp4|webm|jpg|png|webp|avif|gif)$/.test(name) ||
		!name.endsWith('.' + mediaExtensions[blob.type])
	)
		throw new Error('Invalid local media file');
	return { blob, name };
}
