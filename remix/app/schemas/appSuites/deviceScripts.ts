import type { BehaviourSuite } from '../behaviourSuites';
import { el, ifTruthy, ifEquals, fmt, makeKit, makeTheme } from './kit';
const k = makeKit(makeTheme());
const commandPath = '/api/v1/devices/commands';
const request = (method: string, body?: unknown, query?: unknown) => ({
	op: 'http.request',
	method,
	path: commandPath,
	feature: 'api.devices-commands',
	minimumVersion: '1.10.0',
	...(body ? { body } : {}),
	query: query || {}
});
const deviceInput = { name: 'deviceId', type: 'string' as const, label: 'Paired device', required: true };
const commandInput = { name: 'commandId', type: 'string' as const, label: 'Command ID', required: true };
const scriptInput = {
	name: 'script',
	// JSON string inputs preserve full-sized source literally, including leading $ refs.
	type: 'json' as const,
	label: 'Bash script',
	required: true,
	default: "printf 'Hello from '; /usr/sbin/scutil --get ComputerName"
};
const timeoutInput = { name: 'timeoutSeconds', type: 'number' as const, label: 'Timeout (seconds)', default: 10 };
const endpoints = (...values: string[]) => [{ capability: 'http.request', endpoints: values }];
const readCommand = request('GET', undefined, { deviceId: '$input.deviceId', commandId: '$input.commandId' });
export const deviceScriptsSuite: BehaviourSuite = {
	key: 'device-scripts',
	title: 'Device scripts',
	emoji: '⌘',
	tone: '#18181b',
	description: 'Save Bash recipes as Actions, run them on your paired Mac, and use or save the private result in any Builder component.',
	story: [
		'Choose a paired Mac and write a script.',
		'Review and approve the exact script in Devices.',
		'Read stdout, stderr and exit status, then optionally save the result as a private Thing.'
	],
	app: { tagline: 'Your paired Mac, connected to your components.' },
	schemas: [],
	data: [],
	components: [
		{
			key: 'workbench',
			name: 'Paired device script workbench',
			description: 'Editable Actions and controls for approved device scripts and private result Things.',
			args: [],
			render: (refs) =>
				k.stack(
					[
						k.label('Builder tools'),
						k.title('Device scripts'),
						k.text('A reusable bridge between a paired Mac, saved Actions and your Things.'),
						k.muted(
							'Scripts run as your Mac user and can change files or access the network. Each run needs approval of the exact code. They are not sandboxed. Output is limited to 16 KiB; interrupted or truncated output is marked explicitly.'
						),
						...k.gates(
							'Device scripts',
							'Run reusable scripts on a paired Mac.',
							k.stack([
								k.group([
									k.field('Paired Mac', {
										tag: 'tt-select',
										props: {
											name: 'deviceId',
											optionsPath: 'result.devices',
											labelPath: 'name',
											valuePath: 'id',
											filterPath: 'platform',
											filterValue: 'macos'
										}
									}),
									k.field(
										'Run ID',
										k.input('requestId', { placeholder: 'example-1' }),
										'Choose a new ID for a new run. Retry an uncertain submission with the same ID and unchanged script.'
									),
									k.field('Bash', {
										...k.textarea('script', { rows: 6, required: true }, { fontFamily: 'monospace' }),
										children: [scriptInput.default]
									}),
									k.field('Timeout (1–30 seconds)', k.input('timeoutSeconds', { type: 'number', value: 10, min: 1, max: 30 })),
									k.row([
										k.button('Request run', refs.actionKey('run'), {
											deviceId: '{deviceId}',
											requestId: '{requestId}',
											script: '{script}',
											timeoutSeconds: '{timeoutSeconds}'
										}),
										k.link('Review approvals', '/things')
									]),
									k.field('Recipe name', k.input('recipeName', { value: 'My Mac script' })),
									k.button(
										'Save reusable Action',
										refs.actionKey('save-recipe'),
										{ recipeName: '{recipeName}', script: '{script}', timeoutSeconds: '{timeoutSeconds}' },
										'ghost'
									)
								]),
								ifTruthy(
									'last.result.command.id',
									k.group([
										k.card([
											k.strong('Command {last.result.command.id}'),
											k.pill('{last.result.command.status}'),
											k.button(
												'Read this result',
												refs.actionKey('read-result'),
												{ deviceId: '{last.result.command.deviceId}', commandId: '{last.result.command.id}' },
												'ghost'
											),
											ifTruthy(
												'last.result.command.result',
												k.stack([
													ifEquals(
														'last.result.command.result.exitCode',
														0,
														k.pill('Exited successfully'),
														k.pill('Script did not exit successfully')
													),
													ifTruthy('last.result.command.result.timedOut', k.notice('Stopped after the time limit.', 'danger')),
													ifTruthy('last.result.command.result.truncated', k.notice('Output limit reached. This is a partial result.', 'danger')),
													k.label('stdout'),
													el('pre', { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }, ['{last.result.command.result.stdout}']),
													k.label('stderr'),
													el('pre', { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }, ['{last.result.command.result.stderr}']),
													fmt('last.result.command.result', 'json'),
													k.button(
														'Save result as a private Thing',
														refs.actionKey('save-result'),
														{ deviceId: '{last.result.command.deviceId}', commandId: '{last.result.command.id}' },
														'ghost'
													)
												])
											)
										])
									])
								),
								ifTruthy('last.result.id', k.link('Open saved Thing', '/thing/{last.result.id}')),
								el('details', {}, [
									el('summary', {}, ['Read an earlier run']),
									k.group([
										k.field('Device ID', k.input('deviceId', { required: true })),
										k.field('Command ID', k.input('commandId', { required: true })),
										k.button('Read result', refs.actionKey('read-result'), { deviceId: '{deviceId}', commandId: '{commandId}' }, 'ghost')
									])
								]),
								k.muted(
									'Results are available privately for ten minutes. Saving is explicit; the saved Thing stays in your library. Edit a saved recipe’s source and inputs in Builder, or bind the read-result Action as another component’s source.'
								)
							])
						)
					],
					{ maxWidth: '760px', width: '100%', minWidth: 0 }
				)
		}
	],
	actions: [
		{
			key: 'devices',
			description: 'List Macs paired to your account.',
			category: 'Devices',
			name: 'Read paired Macs',
			runtime: 'browser',
			inputs: [],
			steps: () => [
				{ op: 'http.request', method: 'GET', path: '/api/v1/devices', feature: 'api.devices', minimumVersion: '1.10.0', query: {} },
				{ op: 'return', value: '$step.1' }
			],
			capabilities: () => endpoints('GET /api/v1/devices')
		},
		{
			key: 'run',
			category: 'Devices',
			name: 'Run Bash on a paired Mac',
			description: 'Queues an idempotent script for fresh approval; returns a command receipt, not execution success.',
			runtime: 'browser',
			limits: { maxInputBytes: 65536 },
			inputs: [
				deviceInput,
				{ name: 'requestId', type: 'string', label: 'Run ID', required: true },
				scriptInput,
				timeoutInput,
				{ name: 'recipeName', type: 'string', label: 'Recipe name' }
			],
			steps: () => [
				request('POST', {
					deviceId: '$input.deviceId',
					requestId: '$input.requestId',
					kind: 'script.run',
					input: { script: '$input.script', timeoutSeconds: '$input.timeoutSeconds' }
				}),
				{ op: 'return', value: '$step.1' }
			],
			capabilities: () => endpoints(`POST ${commandPath}`)
		},
		{
			key: 'read-result',
			description: 'Read a private, unexpired command result.',
			category: 'Devices',
			name: 'Read paired-device command result',
			runtime: 'browser',
			inputs: [deviceInput, commandInput],
			steps: () => [readCommand, { op: 'return', value: '$step.1' }],
			capabilities: () => endpoints(`GET ${commandPath}`)
		},
		{
			key: 'save-result',
			description: 'Explicitly retain the available output as a private Thing.',
			category: 'Devices',
			name: 'Save script result as a private Thing',
			runtime: 'browser',
			inputs: [deviceInput, commandInput],
			steps: () => [
				readCommand,
				{
					op: 'fail',
					when: { ttExpr: ['or', { ttExpr: ['ne', '$step.1.command.kind', 'script.run'] }, { ttExpr: ['isEmpty', '$step.1.command.result'] }] },
					message: 'No completed script result is available. Read the run again after approval and execution.'
				},
				{
					op: 'http.request',
					method: 'POST',
					path: '/api/v1/things',
					feature: 'api.things',
					minimumVersion: '1.33.0',
					query: {},
					body: {
						thingtime: ['data'],
						acl: ['tt:user'],
						crystal: {
							name: 'Device script result',
							kind: 'device-script-result',
							deviceId: '$input.deviceId',
							commandId: '$input.commandId',
							savedAt: '$now',
							exitCode: '$step.1.command.result.exitCode',
							timedOut: '$step.1.command.result.timedOut',
							truncated: '$step.1.command.result.truncated'
						},
						extended: { result: '$step.1.command.result' }
					}
				},
				{ op: 'return', value: { id: '$step.3.thing.id', silent: true } }
			],
			capabilities: () => endpoints(`GET ${commandPath}`, 'POST /api/v1/things')
		},
		{
			key: 'save-recipe',
			description: 'Save an editable Bash recipe as a private Action.',
			category: 'Devices',
			name: 'Save reusable device script Action',
			runtime: 'browser',
			limits: { maxInputBytes: 65536 },
			// Both buttons share the editable source form; pairing fields are optional when saving.
			inputs: [
				{ name: 'recipeName', type: 'string', label: 'Recipe name', required: true },
				scriptInput,
				timeoutInput,
				{ ...deviceInput, required: false },
				{ name: 'requestId', type: 'string', label: 'Run ID' }
			],
			steps: () => [
				{
					op: 'http.request',
					method: 'POST',
					path: '/api/v1/things',
					feature: 'api.things',
					minimumVersion: '1.33.0',
					query: {},
					body: {
						thingtime: ['action'],
						acl: ['tt:user'],
						crystal: {
							name: '$input.recipeName',
							runtime: 'browser',
							limits: { maxInputBytes: 65536 },
							description: 'An approved Bash recipe for a paired Mac. Each new run requires a new requestId and fresh script approval.',
							inputs: [
								deviceInput,
								{ name: 'requestId', type: 'string', label: 'Run ID', required: true },
								{ ...scriptInput, default: '$input.script' }
							],
							capabilities: endpoints(`POST ${commandPath}`),
							steps: [
								request('POST', {
									deviceId: '$$input.deviceId',
									requestId: '$$input.requestId',
									kind: 'script.run',
									input: { script: '$$input.script', timeoutSeconds: '$input.timeoutSeconds' }
								}),
								{ op: 'return', value: '$$step.1' }
							]
						}
					}
				},
				{ op: 'return', value: { id: '$step.1.thing.id', silent: true } }
			],
			capabilities: () => endpoints('POST /api/v1/things')
		}
	],
	pages: [
		{
			key: 'home',
			name: 'Device scripts',
			blocks: (ctx, refs) => [
				{
					id: ctx.id('workbench'),
					type: 'component',
					component: refs.component('workbench'),
					source: { action: refs.actionKey('devices'), refresh: 'interval', intervalMs: 30000 }
				}
			]
		}
	]
};
