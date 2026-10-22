import { mediaConversionProgram } from './mediaConversionProgram';
import type { PlatformNode } from './types';

/** Plain child elements, also expanded into individually editable Page blocks. */
export function mediaCompressorTemplate() {
	const program = mediaConversionProgram();
	const controlStyle = {
		font: 'inherit',
		width: '100%',
		minWidth: 0,
		boxSizing: 'border-box',
		padding: '10px 12px',
		border: '1px solid #d4d4d8',
		borderRadius: '8px',
		background: '#fff',
		color: '#18181b'
	};
	const options: Record<string, string[]> = {
		format: ['mp4', 'webm'],
		imageFormat: ['auto', 'webp', 'jpeg', 'png', 'avif', 'gif'],
		audio: ['keep', 'remove'],
		imageBackground: ['none', '#ffffff', '#000000']
	};
	const labels: Record<string, string> = {
		imageFormat: 'Image format',
		imageQuality: 'Image quality (1–100)',
		imageBackground: 'Background for JPEG',
		format: 'Video format',
		audio: 'Video audio'
	};
	const field = (parameter: NonNullable<typeof program.parameters>[number]) => ({
		tag: 'label',
		props: { style: { display: 'grid', gap: '6px', minWidth: 0 } },
		children: [
			{ tag: 'span', children: [labels[parameter.name] || parameter.label] },
			options[parameter.name]
				? {
						tag: 'select',
						props: { name: parameter.name, 'aria-label': labels[parameter.name] || parameter.label, value: parameter.default, style: controlStyle },
						children: options[parameter.name].map((value) => ({
							tag: 'option',
							props: { value },
							children: [value === 'auto' ? 'Automatic (WebP)' : value === 'none' ? 'Keep transparency' : value]
						}))
				  }
				: {
						tag: 'input',
						props: {
							name: parameter.name,
							'aria-label': labels[parameter.name] || parameter.label,
							type: parameter.type === 'number' ? 'number' : 'text',
							value: parameter.default,
							...(parameter.name === 'imageQuality' ? { min: 1, max: 100 } : {}),
							style: controlStyle
						}
				  }
		]
	});
	const settings = {
		tag: 'details',
		children: [
			{
				tag: 'summary',
				props: { style: { cursor: 'pointer', padding: '12px 0', minHeight: '44px', boxSizing: 'border-box' } },
				children: ['Compression settings']
			},
			{
				tag: 'p',
				children: [
					'Image quality affects lossy formats; PNG is lossless. Automatic exports WebP, including animation and transparency. JPEG requires an explicit background for transparent images.'
				]
			},
			{
				tag: 'div',
				props: { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: '12px', padding: '12px 0' } },
				children: program.parameters!.map(field)
			}
		]
	};
	const convert = (node: PlatformNode): any =>
		typeof node === 'string'
			? node
			: {
					tag: node.tag,
					props: {
						...node.attributes,
						...(node.attributes?.playsinline ? { playsinline: undefined, playsInline: true } : {}),
						...(node.attributes?.for ? { for: undefined, htmlFor: node.attributes.for } : {}),
						...(node.tag === 'section' ? { style: { display: 'grid', gap: '12px', minWidth: 0 } } : {}),
						...(['input', 'video', 'img', 'progress'].includes(node.tag)
							? {
									style: {
										width: '100%',
										minWidth: 0,
										maxWidth: '100%',
										...(node.tag === 'img' || node.tag === 'video' ? { maxHeight: '360px', objectFit: 'contain' } : {}),
										...(node.tag === 'input' ? { minHeight: '44px' } : {})
									}
							  }
							: {}),
						...(node.tag === 'button' ? { style: { ...controlStyle, width: 'auto', minHeight: '44px', cursor: 'pointer' } } : {}),
						...(node.attributes?.class === 'media-buttons' ? { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } } : {})
					},
					children: node.children?.flatMap((child) => {
						const converted = convert(child);
						return typeof child !== 'string' && child.tag === 'input' && child.attributes?.type === 'file' ? [converted, settings] : [converted];
					})
			  };
	return {
		tag: 'tt-media-pipeline',
		props: { pipeline: { ...program.media, download: '#media-download' } },
		children: [
			...program.document!.map(convert),
			{
				tag: 'a',
				props: {
					id: 'media-download',
					hidden: true,
					style: {
						display: 'none',
						marginTop: '12px',
						padding: '12px 16px',
						border: '1px solid #d4d4d8',
						borderRadius: '8px',
						color: 'inherit',
						overflowWrap: 'anywhere'
					}
				},
				children: ['Download output']
			}
		]
	};
}
