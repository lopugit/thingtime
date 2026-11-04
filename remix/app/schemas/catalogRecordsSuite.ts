import type { BehaviourSuite, SuiteRefs } from './behaviourSuites';

export const CATALOG_RECORD_ACTION = 'demo-catalog-records-save';
export const catalogRecordsSuite: BehaviourSuite = {
	key: 'catalog-records',
	title: 'Component records',
	emoji: '🧩',
	tone: 'paper',
	description: 'Save component values and integration drafts as private Things.',
	story: [
		'Catalog controls change their local state immediately. Save a record to keep the current values in your Things.',
		'Integration drafts do not send messages, transfer money, or control devices. Connect an appropriate Action for those effects.'
	],
	schemas: [
		{
			key: 'record',
			description: 'A saved component record or integration draft.',
			fields: [
				{ name: 'title', type: 'string', required: true, maxLength: 200 },
				{ name: 'family', type: 'string', required: true, maxLength: 100 },
				{ name: 'details', type: 'string', maxLength: 5000 },
				{ name: 'createdAt', type: 'date' }
			]
		}
	],
	actions: [
		{
			key: 'save',
			name: 'Save component record',
			category: 'components',
			description: 'Creates a private record of component values. No external effects.',
			inputs: [
				{ name: 'title', type: 'string', label: 'Title', required: true, maxLength: 200 },
				{ name: 'family', type: 'string', label: 'Component family', required: true, maxLength: 100 },
				{ name: 'details', type: 'text', label: 'Details', maxLength: 5000 }
			],
			steps: (refs: SuiteRefs) => [
				{
					op: 'things.create',
					schema: refs.schema('record'),
					values: { title: '$input.title', family: '$input.family', details: '$input.details', createdAt: '$now' }
				},
				{ op: 'return', value: { id: '$step.1.id', message: 'Record saved privately in your Things.' } }
			],
			capabilities: (refs: SuiteRefs) => [{ capability: 'things.create', schemas: [refs.schema('record')] }]
		},
		{
			key: 'recent',
			name: 'Read component records',
			category: 'components',
			description: 'Lists your latest component records.',
			inputs: [],
			steps: (refs: SuiteRefs) => [
				{ op: 'things.search', schema: refs.schema('record'), limit: 20 },
				{ op: 'return', value: '$step.1' }
			],
			capabilities: (refs: SuiteRefs) => [{ capability: 'things.read', schemas: [refs.schema('record')] }]
		}
	],
	components: [
		{
			key: 'records',
			name: 'Saved component records',
			description: 'Read your saved component records.',
			args: [],
			render: (refs) => ({
				tag: 'button',
				props: { type: 'button' },
				ttAction: refs.actionKey('recent'),
				ttActionInputs: {},
				children: ['Read saved records']
			})
		}
	],
	data: [],
	page: (ctx, refs) => [{ id: ctx.id('records'), type: 'component', component: refs.component('records') }]
};
