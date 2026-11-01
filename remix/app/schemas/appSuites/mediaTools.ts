import type { BehaviourSuite } from '../behaviourSuites';
import { webStandardsSuite } from './webStandards';
import { mediaConversionProgram } from '../../webPlatform/mediaConversionProgram';

/** Ordinary Component/Action/Page definitions; installation creates owned Things. */
export const mediaToolsSuite: BehaviourSuite = {
	key: 'media-tools',
	title: 'Local video tools',
	emoji: '🎞️',
	tone: 'paper',
	description: 'Compress and resize selected videos on your device. Edit the reusable program and save your own compressor Components.',
	story: [
		'Choose output settings and Run example.',
		'Select a local video, Start, preview and download the encoded result.',
		'Save edited component to keep your layout and settings as reusable Thingtime data.'
	],
	app: { entry: 'home', tagline: 'Your video, your device, your reusable tools.' },
	schemas: [],
	data: [],
	actions: [{ ...webStandardsSuite.actions.find((action) => action.key === 'save-draft')!, category: 'Media tools' }],
	components: [
		{
			key: 'compressor',
			name: 'Local video compressor',
			args: [],
			description: 'Editable Web Platform media pipeline: selected file, resizing, encoding, progress, cancellation, preview and download.',
			render: (refs) => ({
				tag: 'fieldset',
				props: { style: { border: 'none', padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: '16px' } },
				children: [
					{ tag: 'h1', children: ['Local video compressor'] },
					{ tag: 'p', children: [mediaConversionProgram().description] },
					{ tag: 'tt-web-platform', props: { name: 'program', program: mediaConversionProgram() } },
					{
						tag: 'button',
						props: { type: 'button' },
						ttAction: refs.actionKey('save-draft'),
						ttActionInputs: {},
						children: ['Save edited component']
					},
					{ ttIf: { arg: 'last.result.id', then: { tag: 'a', props: { href: '/thing/{last.result.id}' }, children: ['Open saved component'] } } },
					{
						tag: 'p',
						children: [
							'Your selected file and output are temporary and stay on this device. Saving stores the program and input defaults, never video bytes. MP4 (H.264/AAC) and WebM (VP9/Opus) depend on your browser codecs. Only primary video and audio tracks are kept; subtitles, extra tracks and metadata are omitted.'
						]
					},
					{
						tag: 'nav',
						props: { style: { display: 'flex', gap: '16px', flexWrap: 'wrap' } },
						children: [
							{ tag: 'a', props: { href: '/p/web-standards' }, children: ['Web standards'] },
							{ tag: 'a', props: { href: '/docs/builder#local-media' }, children: ['Builder media guide'] }
						]
					}
				]
			})
		}
	],
	pages: [
		{
			key: 'home',
			name: 'Local video tools',
			blocks: (ctx, refs) => [
				{
					id: ctx.id('shell'),
					type: 'container',
					direction: 'column',
					align: 'center',
					maxWidth: 900,
					css: { width: '100%', 'min-width': '0', padding: '24px 16px 64px' },
					children: [{ id: ctx.id('compressor'), type: 'component', component: refs.component('compressor') }]
				}
			]
		}
	]
};
