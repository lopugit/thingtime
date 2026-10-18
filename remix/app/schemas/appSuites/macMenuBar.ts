import type { BehaviourSuite } from '../behaviourSuites';
import { el, ifTruthy, ifEquals, fmt, makeKit, makeTheme } from './kit';
const k = makeKit(makeTheme());
const field = (label: string, key: string) =>
	k.stack([
		k.label(label),
		ifEquals(
			`item.${key}`,
			null,
			k.muted('Unavailable'),
			k.text(`{item.${key}}`, { overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: '12px' })
		)
	]);
const row = k.card(
	[
		k.row([ifTruthy('item.label', k.strong('{item.label}'), k.strong('{item.program}')), k.pill('{item.source}')]),
		k.muted('{item.program} · PID {item.processId}'),
		el('details', {}, [
			el('summary', { cursor: 'pointer', fontSize: '13px' }, ['Program details & stats']),
			k.stack(
				[
					field('Application', 'appPath'),
					field('Executable', 'executablePath'),
					field('Bundle ID', 'bundleId'),
					field('Resident memory (bytes, whole process)', 'residentBytes'),
					field('CPU time (seconds, whole process)', 'cpuTimeSeconds'),
					k.row([field('X', 'x'), field('Y', 'y'), field('Width', 'width'), field('Height', 'height')]),
					field('On screen', 'visible'),
					k.muted('Process totals are shared by icons belonging to the same program. CPU time is cumulative, not CPU usage %.')
				],
				{ marginTop: '14px' }
			)
		])
	],
	{ minWidth: 0 }
);
const device = k.stack(
	[
		k.row([k.title('{item.name}'), ifTruthy('item.online', k.pill('Connected'), k.pill('Offline · last snapshot'))]),
		k.muted('{item.model} · {item.osVersion}'),
		ifTruthy(
			'item.state.menuBar',
			k.stack([
				k.row([k.pill('{item.state.menuBar.status}'), k.muted('Collected'), fmt('item.state.menuBar.collectedAt', 'datetime')]),
				ifEquals(
					'item.state.menuBar.status',
					'partial',
					k.muted(
						'Partial inventory. Some apps do not expose their status items. Accessibility access enables labels; hidden items may remain unavailable.'
					)
				),
				ifEquals('item.state.menuBar.status', 'collecting', k.muted('Reading the Mac menu bar. The next sync will bring its inventory.')),
				ifEquals('item.state.menuBar.status', 'locked', k.muted('Unlock this Mac to resume its menu bar inventory.')),
				ifEquals('item.state.menuBar.accessibility', false, k.link('Review Mac permissions', '/things')),
				el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '12px', minWidth: 0 }, [
					{
						tag: 'tt-collection',
						props: {
							itemsPath: 'item.state.menuBar.items',
							label: 'Menu bar items',
							empty: 'No menu bar items reported in this snapshot.',
							size: 10,
							itemTemplate: { ttTemplate: row }
						}
					}
				])
			]),
			k.card([
				k.strong('Menu bar sync needs a compatible Mac node'),
				k.muted('Update Thingtime on this Mac and keep its paired node running. No menu bar snapshot has arrived yet.')
			])
		)
	],
	{ gap: '16px', marginTop: '24px', minWidth: 0 }
);
export const macMenuBarSuite: BehaviourSuite = {
	key: 'mac-menu-bar',
	title: 'Mac menu bar',
	emoji: '▤',
	tone: '#18181b',
	description: 'Your Mac status items, their owning programs, paths and process stats in editable Thingtime components.',
	story: [
		'Pair your Mac with Thingtime.',
		'Open this private page to read the latest synced status-item inventory.',
		'Edit the component, its read Action, device selection or refresh interval in Builder.'
	],
	app: { tagline: 'Know what lives in your menu bar.' },
	schemas: [],
	data: [],
	components: [
		{
			key: 'inventory',
			name: 'Mac menu bar inventory',
			description: 'Reusable private device inventory with expandable program metadata. All markup is editable.',
			args: [{ name: 'deviceId', type: 'string', label: 'Device ID (blank shows all paired Macs)', default: '' }],
			render: (refs) =>
				k.stack(
					[
						k.label('Your devices'),
						k.title('Mac menu bar', { fontSize: '36px', letterSpacing: '-0.04em' }),
						k.text('Every reported status item, with the program behind it.'),
						k.group([
							k.field('Paired device ID (blank shows all)', k.input('deviceId', { defaultValue: '{query.deviceId}' })),
							k.localButton('Choose device', { op: 'query', form: true, params: { deviceId: '{query.deviceId}' } })
						]),
						k.row([
							k.button('Refresh', refs.actionKey('read'), { deviceId: '{query.deviceId}' }, 'ghost'),
							k.link('Manage devices', '/things', 'ghost')
						]),
						k.muted('Refreshes every 30 seconds while open. Change the device ID and source interval in Builder. Paths stay within your account.'),
						...k.gates('Mac menu bar', 'See the status items synced from your paired Mac.', {
							tag: 'tt-collection',
							props: {
								itemsPath: 'result.devices',
								filterPath: 'platform',
								filterValue: 'macos',
								label: 'Paired Macs',
								empty: 'Pair Thingtime on your Mac to start syncing its menu bar.',
								hideSearch: true,
								size: 5,
								itemTemplate: { ttTemplate: device }
							}
						})
					],
					{ minWidth: 0 }
				)
		}
	],
	actions: [
		{
			key: 'read',
			name: 'Read paired device inventory',
			description: 'Read-only owner-authenticated device snapshots. No commands run and no copy of the snapshot is saved.',
			category: 'Devices',
			runtime: 'browser',
			inputs: [{ name: 'deviceId', type: 'string', label: 'Device ID', default: '' }],
			steps: () => [
				{
					op: 'http.request',
					method: 'GET',
					path: '/api/v1/devices',
					feature: 'api.devices',
					minimumVersion: '1.10.0',
					query: { id: '$input.deviceId' }
				},
				{ op: 'return', value: '$step.1' }
			],
			capabilities: () => [{ capability: 'http.request', endpoints: ['GET /api/v1/devices'] }]
		}
	],
	pages: [
		{
			key: 'home',
			name: 'Mac menu bar',
			blocks: (ctx, refs) => [
				{
					id: ctx.id('shell'),
					type: 'container',
					direction: 'column',
					align: 'center',
					maxWidth: 1100,
					gap: 8,
					css: { width: '100%', 'min-width': '0', padding: '28px 18px 80px' },
					children: [
						{
							id: ctx.id('inventory'),
							type: 'component',
							component: refs.component('inventory'),
							source: { action: refs.actionKey('read'), inputs: { deviceId: '{query.deviceId}' }, refresh: 'interval', intervalMs: 30000 }
						}
					]
				}
			]
		}
	]
};
