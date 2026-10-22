import { mediaCompressorTemplate } from '../../webPlatform/mediaCompressorTemplate';
import { templateToBlocks } from '../../components/Builder/templateBlocks';
import type { BehaviourSuite } from '../behaviourSuites';
import { webStandardsSuite } from './webStandards';

/** Ordinary Component/Action/Page definitions; installation creates owned Things. */
export const mediaToolsSuite: BehaviourSuite = {
	key: 'media-tools',
	title: 'Local image and video tools',
	emoji: '🗜️',
	tone: 'paper',
	description: 'Compress and resize images and videos locally. Edit individual controls, text and layout in Builder.',
	story: [
		'Open the page and select an image or video.',
		'Adjust compression settings if needed, Start, preview and download the result.',
		'Edit and save individual blocks in Builder to keep your layout and defaults.'
	],
	app: { entry: 'home', tagline: 'Your files, your device, your reusable tools.' },
	schemas: [],
	data: [],
	actions: [{ ...webStandardsSuite.actions.find((action) => action.key === 'save-draft')!, category: 'Media tools' }],
	components: [
		{
			key: 'compressor',
			name: 'Local image and video compressor',
			args: [],
			description: 'Editable Web Platform media pipeline: selected file, resizing, encoding, progress, cancellation, preview and download.',
			render: () => mediaCompressorTemplate()
		}
	],
	pages: [
		{
			key: 'home',
			name: 'Local image and video tools',
			blocks: (ctx) => [
				{
					id: ctx.id('shell'),
					type: 'container',
					direction: 'column',
					align: 'center',
					maxWidth: 900,
					css: { width: '100%', 'min-width': '0', padding: '24px 16px 64px' },
					children: templateToBlocks(mediaCompressorTemplate(), kind => ctx.id(kind))
				}
			]
		}
	]
};
