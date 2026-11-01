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
		title: 'Local video compressor',
		description:
			'Choose settings, Run example, then select a local MP4, MOV, WebM or MKV video and Start. Encoding stays on this device. MP4 uses H.264/AAC; WebM uses VP9/Opus when supported by this browser. A smaller file is not guaranteed; actual before/after sizes are reported.',
		parameters: [
			{ name: 'format', label: 'Output format (mp4 or webm)', type: 'text', default: 'mp4' },
			{ name: 'maxWidth', label: 'Maximum width', type: 'number', default: 1280 },
			{ name: 'maxHeight', label: 'Maximum height', type: 'number', default: 720 },
			{ name: 'videoBitrate', label: 'Video bitrate (bits/second)', type: 'number', default: 1_500_000 },
			{ name: 'frameRate', label: 'Frames per second', type: 'number', default: 30 },
			{ name: 'audio', label: 'Audio (keep or remove)', type: 'text', default: 'keep' },
			{ name: 'audioBitrate', label: 'Audio bitrate (bits/second)', type: 'number', default: 96_000 }
		],
		document: [
			node('section', { id: 'media-tool' }, [
				node('h2', {}, ['Make a smaller video']),
				node('p', {}, [
					'Your video stays on this device. Encoding speed and file capacity depend on your browser and available memory. Only the primary video and audio tracks are retained.'
				]),
				node('label', { for: 'media-file' }, ['Choose a video']),
				node('input', { id: 'media-file', type: 'file', accept: 'video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv' }),
				node('div', { class: 'media-buttons' }, [
					node('button', { id: 'media-start', type: 'button' }, ['Start']),
					node('button', { id: 'media-cancel', type: 'button' }, ['Cancel'])
				]),
				node('progress', { id: 'media-progress', max: 100, value: 0, 'aria-label': 'Encoding progress' }),
				node('output', { id: 'media-status', 'aria-live': 'polite' }, ['Choose a local video.']),
				node('video', { id: 'media-preview', controls: true, playsinline: true, preload: 'metadata', 'aria-label': 'Converted video' }),
				node('p', {}, [
					'When complete, use Download output below the preview. Editing settings and running again clears the selected file and the previous output.'
				])
			])
		],
		styles: [
			{ selector: '#media-tool', declarations: { display: 'grid', gap: '12px', 'max-width': '720px', margin: '0 auto' } },
			{ selector: 'h2,p', declarations: { margin: '0' } },
			{ selector: 'input,progress,video', declarations: { width: '100%', 'min-width': '0', 'max-width': '100%' } },
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
			output: {
				format: input('format'),
				maxWidth: input('maxWidth'),
				maxHeight: input('maxHeight'),
				videoBitrate: input('videoBitrate'),
				frameRate: input('frameRate'),
				audio: input('audio'),
				audioBitrate: input('audioBitrate')
			}
		}
	};
}
