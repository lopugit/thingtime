import { base, parameter, recipe } from './programBuilders';
import type { Feature, PlatformDOMBinding, PlatformNode, PlatformProgram, Recipe } from './types';

const node = (tag: string, attributes: Record<string, string | number | boolean> = {}, children: PlatformNode[] = []): PlatformNode => ({
	tag,
	attributes,
	children
});
const button = (id: string, text: string) => node('button', { id, type: 'button' }, [text]);
const input = (name: string) => ({ op: 'input' as const, name });
const pointer = new Set(
	'click auxclick dblclick contextmenu mousedown mouseup mouseenter mouseleave mousemove mouseover mouseout pointerdown pointerup pointerenter pointerleave pointermove pointerover pointerout'.split(
		' '
	)
);
const editing = new Set('beforeinput input change keydown keypress keyup focus blur select'.split(' '));
const drag = new Set('drag dragstart dragend dragenter dragleave dragover drop'.split(' '));
const animation = new Set('animationstart animationiteration animationend animationcancel'.split(' '));
const transition = new Set('transitionrun transitionstart transitionend transitioncancel'.split(' '));
const supported = new Set([
	...pointer,
	...editing,
	...drag,
	...animation,
	...transition,
	'wheel',
	'scroll',
	'scrollend',
	'cancel',
	'close',
	'toggle',
	'beforetoggle',
	'submit',
	'reset',
	'invalid',
	'load',
	'error',
	'command'
]);

/** Actual active-document triggers, saved as ordinary editable program data. */
export function liveEventRecipe(f: Feature): Recipe | undefined {
	const handler =
		(f.language === 'html' && f.kind === 'attribute' && f.name.startsWith('on')) ||
		(f.language === 'webapi' && f.kind === 'attribute' && f.interface === 'GlobalEventHandlers' && f.member?.startsWith('on'));
	const eventName = handler ? (f.member || f.name).slice(2) : f.language === 'html' && f.kind === 'event' ? f.name : undefined;
	if (!eventName || !supported.has(eventName)) return;
	const program: PlatformProgram = {
		...base(f),
		parameters: [],
		dom: [],
		styles: [
			{ selector: '#parent', declarations: { padding: '16px', border: '1px solid #a78bfa', 'border-radius': '12px', display: 'grid', gap: '12px' } },
			{ selector: 'button, input', declarations: { font: 'inherit', padding: '8px', 'max-width': '100%', 'box-sizing': 'border-box' } },
			{ selector: '.buttons', declarations: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } },
			{
				selector: '.sample',
				declarations: { padding: '16px', background: '#ede9fe', border: '1px solid #8b5cf6', 'border-radius': '8px', color: '#312e81' }
			}
		]
	};
	const param = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' = 'text') =>
		program.parameters!.push(parameter(name, label, value, type));
	const operation = (target: string, trigger: string, method: string, args: unknown[] = []): PlatformDOMBinding => ({
		target,
		event: `#${trigger}|click`,
		method,
		args
	});
	const operations: PlatformDOMBinding[] = [];
	let target = '#sample',
		help = '';
	param('text', 'Example text', 'Hello Thingtime');
	if (pointer.has(eventName)) {
		help =
			'Use the pointer over the nested control: click, double-click, press another mouse button, or enter and leave its children. Receipts show the actual event phase, coordinates and pointer details where supplied.';
		program.document = [
			node('section', { id: 'parent' }, [
				node('p', {}, [help]),
				node('button', { id: 'sample', type: 'button', class: 'sample' }, [node('span', {}, ['[[text]]'])]),
				button('native-click', 'Invoke native click()')
			])
		];
		operations.push(operation('#sample', 'native-click', 'click'));
	} else if (editing.has(eventName)) {
		help =
			'Edit the text directly inside the preview, press keys, move focus, or select text. Typing produces real input and keyboard events; changing focus commits a change. A method call does not synthesize typing.';
		program.document = [
			node('section', { id: 'parent' }, [
				node('p', {}, [help]),
				node('label', { for: 'sample' }, ['Editable text']),
				node('input', { id: 'sample', value: '[[text]]', type: 'text' }),
				node('div', { class: 'buttons' }, [button('focus', 'Focus text'), button('blur', 'Blur text'), button('select', 'Select text')])
			])
		];
		operations.push(operation('#sample', 'focus', 'focus'), operation('#sample', 'blur', 'blur'), operation('#sample', 'select', 'select'));
	} else if (['submit', 'reset', 'invalid'].includes(eventName)) {
		program.allowFormEvents = true;
		help =
			'Edit the required name, then submit, reset or check validity. Submission is canceled by the isolated runtime before any navigation. Reset restores the authored input default unless its event is canceled.';
		program.parameters![0].default = eventName === 'invalid' ? '' : 'Hello Thingtime';
		const formId = eventName === 'invalid' ? 'form' : 'sample',
			textId = eventName === 'invalid' ? 'sample' : 'text';
		program.document = [
			node('section', { id: 'parent' }, [
				node('p', {}, [help]),
				node('form', { id: formId }, [
					node('label', { for: textId }, ['Required name']),
					node('input', { id: textId, name: 'name', value: '[[text]]', required: true }),
					node('div', { class: 'buttons' }, [
						node('button', { id: 'submit', type: 'submit', name: 'intent', value: 'save' }, ['Submit form']),
						button('reset', 'Reset form'),
						button('validity', 'Check validity')
					])
				])
			])
		];
		operations.push(operation('#' + formId, 'reset', 'reset'), operation('#' + textId, 'validity', 'checkValidity'));
	} else if (eventName === 'cancel' || eventName === 'close') {
		help =
			'Open the dialog, then request closure or close it directly. requestClose and Escape produce a cancel event; preventing that event keeps the dialog open. Direct close bypasses cancel. Close receipts show the native returnValue.';
		param('result', 'Dialog return value', 'saved');
		program.document = [
			node('section', { id: 'parent' }, [
				node('p', {}, [help]),
				button('open', 'Open dialog'),
				node('dialog', { id: 'sample' }, [node('p', {}, ['[[text]]']), button('request', 'Request close'), button('close', 'Close directly')])
			])
		];
		operations.push(
			operation('#sample', 'open', 'showModal'),
			operation('#sample', 'request', 'requestClose', ['[[result]]']),
			operation('#sample', 'close', 'close', ['[[result]]'])
		);
	} else if (eventName === 'toggle' || eventName === 'beforetoggle') {
		help =
			'Toggle the popover using its native invoker. beforetoggle can cancel opening but cannot cancel closing; toggle reports the completed old and new states. The browser may coalesce toggle events.';
		program.document = [
			node('section', { id: 'parent' }, [
				node('p', {}, [help]),
				node('button', { id: 'open', type: 'button', popovertarget: 'sample' }, ['Toggle popover']),
				node('div', { id: 'sample', popover: 'auto', class: 'sample' }, ['[[text]]'])
			])
		];
	} else if (['scroll', 'scrollend', 'wheel'].includes(eventName)) {
		help =
			'Scroll the area with the wheel or the buttons. Wheel cancellation can prevent scrolling unless the listener is passive. scroll and scrollend are distinct non-cancelable notifications; event availability follows this browser.';
		program.document = [
			node('section', { id: 'parent' }, [
				node('p', {}, [help]),
				node('div', { id: 'sample', tabindex: 0, 'aria-label': 'Scrollable example', style: 'height:150px;overflow:auto;border:1px solid #8b5cf6' }, [
					node('div', { style: 'height:900px;padding:16px;background:linear-gradient(#ede9fe,#ccfbf1)' }, ['[[text]]'])
				]),
				node('div', { class: 'buttons' }, [button('down', 'Scroll down'), button('top', 'Back to top')])
			])
		];
		operations.push(operation('#sample', 'down', 'scrollBy', [0, 120]), operation('#sample', 'top', 'scrollTo', [0, 0]));
	} else if (drag.has(eventName)) {
		target = ['drag', 'dragstart', 'dragend'].includes(eventName) ? '#source' : '#sample';
		help =
			'Drag the source into and out of the drop area, then release it. A separate saved dragover listener prevents its default so native dropping is permitted. No clipboard or external file data is read.';
		program.document = [
			node('section', { id: 'parent' }, [
				node('p', {}, [help]),
				node('div', { id: 'source', draggable: true, class: 'sample' }, ['Drag: [[text]]']),
				node('div', { id: 'sample', class: 'sample', style: 'min-height:90px' }, ['Drop here'])
			])
		];
		operations.push({ target: '#sample', event: '#sample|dragover', preventDefault: true, label: 'Allow drop' });
	} else if (animation.has(eventName)) {
		help =
			'Start the CSS animation and observe native lifecycle events. Multiple iterations produce iteration events; removing the animation while it runs produces cancel. Restart after stopping.';
		param('duration', 'Seconds per iteration', 0.5, 'number');
		param('iterations', 'Iteration count', 3, 'number');
		program.document = [
			node('section', { id: 'parent' }, [
				node('p', {}, [help]),
				node('div', { id: 'sample', class: 'sample' }, ['[[text]]']),
				node('div', { class: 'buttons' }, [button('start', 'Start animation'), button('stop', 'Stop animation')])
			])
		];
		program.styles!.push(
			{ rule: '@keyframes thingtime-pulse { from { opacity: 1 } to { opacity: .2 } }' },
			{ selector: '#sample[data-playing]', declarations: { animation: 'thingtime-pulse [[duration]]s linear [[iterations]]' } }
		);
		operations.push(
			operation('#sample', 'start', 'setAttribute', ['data-playing', '']),
			operation('#sample', 'stop', 'removeAttribute', ['data-playing'])
		);
	} else if (transition.has(eventName)) {
		help =
			'Toggle the CSS state to start or reverse a transition. Cancel while it runs to remove the transition. Run the example again to restore it. The receipt distinguishes run, start, end and cancel.';
		param('duration', 'Transition seconds', 1.5, 'number');
		program.document = [
			node('section', { id: 'parent' }, [
				node('p', {}, [help]),
				node('div', { id: 'sample', class: 'sample' }, ['[[text]]']),
				node('div', { class: 'buttons' }, [button('toggle', 'Toggle state'), button('cancel', 'Cancel transition')])
			])
		];
		program.styles!.push(
			{ selector: '#sample', declarations: { opacity: '1', transition: 'opacity [[duration]]s linear' } },
			{ selector: '#sample[data-active]', declarations: { opacity: '.2' } }
		);
		operations.push(
			operation('#sample', 'toggle', 'toggleAttribute', ['data-active']),
			operation('#sample', 'cancel', 'setAttribute', ['style', 'transition:none;opacity:.8'])
		);
	} else if (eventName === 'load' || eventName === 'error') {
		help =
			'The local image produces a real resource load or decode-error event. This demonstrates an element handler; global script errors have a separate calling convention. Run again to recreate the resource.';
		program.document = [
			node('section', { id: 'parent' }, [
				node('p', {}, [help]),
				node('img', {
					id: 'sample',
					alt: '[[text]]',
					width: 80,
					height: 60,
					src: eventName === 'load' ? 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' : 'data:image/png;base64,AAAA'
				})
			])
		];
	} else if (eventName === 'command') {
		help =
			'The button invokes a native custom command on its commandfor target. Custom names begin with two hyphens; the receipt includes the command and its source. Older engines report the missing oncommand handler.';
		param('command', 'Custom command name (without --)', 'thingtime');
		program.document = [
			node('section', { id: 'parent' }, [
				node('p', {}, [help]),
				node('button', { id: 'invoke', type: 'button', commandfor: 'sample', command: '--[[command]]' }, ['Send command']),
				node('div', { id: 'sample', class: 'sample' }, ['[[text]]'])
			])
		];
	}
	param('preventDefault', 'Prevent the event default', false, 'boolean');
	param('stopPropagation', 'Stop propagation', false, 'boolean');
	param('stopImmediatePropagation', 'Stop later listeners too', false, 'boolean');
	const main: PlatformDOMBinding = {
		target,
		event: `${target}|${eventName}`,
		label: 'Selected handler',
		preventDefault: input('preventDefault'),
		stopPropagation: input('stopPropagation'),
		stopImmediatePropagation: input('stopImmediatePropagation')
	};
	if (handler) {
		main.binding = 'handler';
		main.returnFalse = input('returnFalse');
		param('returnFalse', 'Return false from the native on… handler', false, 'boolean');
	} else {
		main.options = { capture: input('capture'), once: input('once'), passive: input('passive') };
		param('capture', 'Capture listener', false, 'boolean');
		param('once', 'Listen once', false, 'boolean');
		param('passive', 'Passive listener', false, 'boolean');
	}
	program.dom = [
		{ target: '#parent', event: `#parent|${eventName}`, options: { capture: true }, label: 'Ancestor capture' },
		main,
		{ target, event: `${target}|${eventName}`, label: 'Later listener' },
		{ target: '#parent', event: `#parent|${eventName}`, label: 'Ancestor bubble' },
		...operations
	];
	program.description = help;
	return recipe(
		program,
		'interactive',
		help +
			(handler
				? ' The on… surface uses the actual native IDL handler property with replacement and return-false behavior; it does not execute inline attribute source.'
				: ' Listener capture, once and passive options are editable.') +
			' The recent event trace retains dispatch-time targets/phases and cancellation after dispatch. Non-bubbling events omit the ancestor bubble callback. All bindings and controls are saved in the Component.'
	);
}
