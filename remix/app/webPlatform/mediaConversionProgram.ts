import type { PlatformNode, PlatformProgram } from './types';

const node = (tag: string, attributes: Record<string, string | number | boolean> = {}, children: PlatformNode[] = []): PlatformNode => ({
	tag,
	attributes,
	children
});
const input = (name: string) => ({ op: 'input' as const, name });
/** The compressor is ordinary editable document/style/program data. */
export function mediaConversionProgram(): PlatformProgram {
	return {
		version: 1,
		title: 'Local image and video compressor',
		description: 'Select a local image or video, adjust settings if needed, then Start. Compression stays on this device. Actual before/after sizes are reported; smaller output is not guaranteed.',
		parameters: [
			{ name: 'format', label: 'Video format (mp4 or webm)', type: 'text', default: 'mp4' },
			{ name: 'maxWidth', label: 'Maximum width', type: 'number', default: 1280 },
			{ name: 'maxHeight', label: 'Maximum height', type: 'number', default: 720 },
			{ name: 'videoBitrate', label: 'Video bitrate (bits/second)', type: 'number', default: 1_500_000 },
			{ name: 'frameRate', label: 'Frames per second', type: 'number', default: 30 },
			{ name: 'audio', label: 'Audio (keep or remove)', type: 'text', default: 'keep' },
			{ name: 'audioBitrate', label: 'Audio bitrate (bits/second)', type: 'number', default: 96_000 },
			{ name: 'imageFormat', label: 'Image format (auto, webp, jpeg, png, avif or gif)', type: 'text', default: 'auto' },
			{ name: 'imageQuality', label: 'Image quality (1–100)', type: 'number', default: 80 },
			{ name: 'imageBackground', label: 'JPEG background (none or #ffffff)', type: 'text', default: 'none' }
		],
		document: [
			node('section', { id: 'media-tool' }, [
				node('h2', {}, ['Make a smaller image or video']),
				node('p', {}, [
					'Your file stays on this device. Images include JPEG, PNG, WebP, GIF, AVIF, HEIC, TIFF, BMP and supported static SVGs. Animated images keep their frames when exported as WebP or GIF. Video codecs and available memory depend on your browser.'
				]),
				node('label', { for: 'media-file' }, ['Choose an image or video']),
				node('input', { id: 'media-file', type: 'file', accept: 'image/*,video/mp4,video/quicktime,video/webm,video/x-matroska,.heic,.heif,.tif,.tiff,.bmp,.ico,.svg,.jxl,.mp4,.mov,.webm,.mkv' }),
				node('div', { class: 'media-buttons' }, [
					node('button', { id: 'media-start', type: 'button' }, ['Start']),
					node('button', { id: 'media-cancel', type: 'button' }, ['Cancel'])
				]),
				node('progress', { id: 'media-progress', max: 100, value: 0, 'aria-label': 'Encoding progress' }),
				node('output', { id: 'media-status', 'aria-live': 'polite' }, ['Choose a local image or video.']),
				node('img', { id: 'media-image-preview', hidden: true, alt: 'Compressed image preview' }),
				node('video', { id: 'media-preview', hidden: true, controls: true, playsinline: true, preload: 'metadata', 'aria-label': 'Converted video' }),
				node('p', {}, [
					'When complete, download the result below. Start applies the current settings to your selected file. Keep this page open while compressing.'
				])
			])
		],
		styles: [
			{ selector: '#media-tool', declarations: { display: 'grid', gap: '12px', 'max-width': '720px', margin: '0 auto' } },
			{ selector: 'h2,p', declarations: { margin: '0' } },
			{ selector: 'input,progress,video,img', declarations: { width: '100%', 'min-width': '0', 'max-width': '100%' } },
			{ selector: 'video', declarations: { 'max-height': '220px', background: '#f4f4f5', 'border-radius': '8px' } },
			{ selector: '.media-buttons', declarations: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } },
			{
				selector: 'button',
				declarations: { padding: '8px 16px', 'border-radius': '8px', border: '1px solid #a1a1aa', background: '#fff', color: '#18181b' }
			},
			{ selector: 'output', declarations: { 'overflow-wrap': 'anywhere' } }
		],
		media: {
			file: '#media-file',
			start: '#media-start',
			cancel: '#media-cancel',
			status: '#media-status',
			progress: '#media-progress',
			preview: '#media-preview',
			imagePreview: '#media-image-preview',
			output: {
				format: input('format'),
				maxWidth: input('maxWidth'),
				maxHeight: input('maxHeight'),
				videoBitrate: input('videoBitrate'),
				frameRate: input('frameRate'),
				audio: input('audio'),
				audioBitrate: input('audioBitrate'),
				imageFormat: input('imageFormat'),
				imageQuality: input('imageQuality'),
				imageBackground: input('imageBackground')
			}
		}
	};
}
