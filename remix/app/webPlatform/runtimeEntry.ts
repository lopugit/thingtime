import { compilePlatformProgram, validatePlatformProgram } from './compiler';
import { compilePlatformWorker } from './workerSource';
import { runPlatformWorker } from './workerLifecycle';
import { inspectPlatformInterface } from './interfaceProbe';
import { createPlatformDOMBridge } from './domBridge';
import { bindLiveDOMEvent, nativeDOMMethod, platformEventReceipt, UnsupportedDOMFeature } from './liveDOM';
import type { PlatformNode } from './types';
// Form controls may shadow instance methods while their parent is being built.
const appendNode = Node.prototype.appendChild;
const listen = EventTarget.prototype.addEventListener;
const closestElement = Element.prototype.closest;
let started = false;
addEventListener('message', (event) => {
	if (event.source !== parent || started || event.data?.type !== 'tt-platform-start') return;
	const { program: raw, input, runId } = event.data;
	if (typeof runId !== 'string' || runId.length > 80 || !input || typeof input !== 'object' || JSON.stringify(input).length > 16384) return;
	started = true;
	const send = (ok: boolean, result: unknown) =>
		parent.postMessage({ type: 'tt-platform-result', runId, ok, text: JSON.stringify(result, null, 2).slice(0, 65536) }, '*');
	const domState = { active: true };
	const unbind: (() => void)[] = [];
	const stopDOM = () => {
		domState.active = false;
		for (const stop of unbind.splice(0)) stop();
	};
	addEventListener('pagehide', stopDOM, { once: true });
	try {
		const program = validatePlatformProgram(raw);
		compilePlatformProgram(program);
		const root = document.getElementById('surface')!;
		let nodes = 0;
		const substitute = (value: unknown) =>
			typeof value === 'string'
				? value.replace(/\[\[([A-Za-z_][A-Za-z0-9_]*)\]\]/g, (_, name) =>
						String(Object.prototype.hasOwnProperty.call(input, name) ? input[name] : '')
				  )
				: String(value);
		const blocked = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'link', 'meta', 'style']);
		const render = (node: PlatformNode, depth = 0): Node => {
			if (++nodes > 300 || depth > 20) throw new Error('Document exceeds its rendering budget');
			if (typeof node === 'string') return document.createTextNode(substitute(node));
			if (!node || typeof node !== 'object' || typeof node.tag !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(node.tag) || blocked.has(node.tag))
				throw new Error('This document element needs a dedicated browsing context');
			const el = document.createElement(node.tag);
			for (const [key, value] of Object.entries(node.attributes || {})) {
				if (/^on/i.test(key) || ['srcdoc', 'is', 'nonce', 'action', 'formaction', 'ping', 'autofocus', 'pattern'].includes(key.toLowerCase()))
					throw new Error('Use declarative events and local document attributes');
				const val = substitute(value);
				if (['src', 'href', 'poster', 'data'].includes(key.toLowerCase()) && !/^#|^data:image\/(png|jpeg|gif|webp);base64,/.test(val))
					throw new Error('Use local demo resources');
				if (value === false) continue;
				el.setAttribute(key, value === true ? '' : val);
			}
			for (const child of node.children || []) appendNode.call(el, render(child, depth + 1));
			return el;
		};
		for (const node of program.document || []) root.appendChild(render(node));
		const sheet = document.createElement('style');
		sheet.textContent = (program.styles || [])
			.map((s) =>
				s.rule
					? substitute(s.rule)
					: `${s.selector}{${Object.entries(s.declarations || {})
							.map(([key, val]) => `${key}:${substitute(val)}`)
							.join(';')}}`
			)
			.join('\n');
		document.head.appendChild(sheet);
		// Install cancellation before any immediate or event-driven call. The
		// sandbox also denies form navigation; requestSubmit still dispatches its
		// real validation/submit events, whose receipts show cancellation.
		listen.call(document, 'submit', (event) => event.preventDefault(), true);
		listen.call(document, 'click', (event) => {
			const a = event.target instanceof Element ? closestElement.call(event.target, 'a') : null;
			if (a && !a.getAttribute('href')?.startsWith('#')) event.preventDefault();
		});
		const events = { used: 0 };
		const observed: (ReturnType<typeof platformEventReceipt> & { label?: string; defaultPreventedAfterDispatch?: boolean })[] = [];
		const immediate: (() => boolean)[] = [];
		let lastDOMResult: { ok: boolean; value: unknown } | undefined;
		const reportDOM = (ok: boolean, value: unknown) => {
			lastDOMResult = { ok, value };
			send(ok, value);
		};
		let eventReportQueued = false;
		const pendingReceipts: { event: Event; receipt: (typeof observed)[number] }[] = [];
		const afterDispatch = (event: Event, receipt: (typeof observed)[number]) => {
			pendingReceipts.push({ event, receipt });
			if (pendingReceipts.length > 20) pendingReceipts.shift();
			if (eventReportQueued) return;
			eventReportQueued = true;
			// A microtask checkpoint can precede the native handler's return-false
			// processing. A new task observes cancellation after dispatch completes.
			setTimeout(() => {
				eventReportQueued = false;
				for (const pending of pendingReceipts.splice(0)) pending.receipt.defaultPreventedAfterDispatch = pending.event.defaultPrevented;
				if (!domState.active || !lastDOMResult?.ok) return;
				const value = lastDOMResult.value;
				reportDOM(true, { ...(value && typeof value === 'object' ? value : {}), events: [...observed] });
			}, 0);
		};
		for (const operation of program.dom || []) {
			const element = root.querySelector(operation.target);
			if (!element) throw new Error(`No element matches ${operation.target}`);
			const execute = (event?: Event) => {
				if (!domState.active) return false;
				try {
					if (++events.used > 200) {
						stopDOM();
						throw new Error('Reset the demo to replenish its event budget');
					}
					if (!operation.method) {
						if (!event) throw new Error('Event observation requires a dispatched event');
						const receipt = { ...platformEventReceipt(event), ...(operation.label ? { label: substitute(operation.label).slice(0, 100) } : {}) };
						observed.push(receipt);
						if (observed.length > 20) observed.shift();
						reportDOM(true, { event: receipt });
						afterDispatch(event, receipt);
						return true;
					}
					const args = (operation.args || []).map((value) => {
						if (value && typeof value === 'object' && !Array.isArray(value) && (value as { op?: unknown }).op === 'element') {
							const selector = (value as { selector?: unknown }).selector;
							if (Object.keys(value).length !== 2 || typeof selector !== 'string' || !selector || selector.length > 500)
								throw new Error('Expected one bounded element selector');
							const target = root.querySelector(selector);
							if (!target) throw new Error(`No element matches ${selector}`);
							return target;
						}
						return typeof value === 'string' ? substitute(value) : value;
					});
					if (operation.method === 'setAttribute' && /^(on|src|href|srcdoc|action|formaction|is|nonce|pattern)/i.test(String(args[0])))
						throw new Error('Attribute is not writable by this control');
					const result = nativeDOMMethod(element, operation.method)(...args);
					if (!domState.active) return false;
					const outcome = {
						method: operation.method,
						result: typeof result === 'object' ? String(result) : result ?? null,
						...(observed.length ? { events: [...observed] } : {})
					};
					reportDOM(true, outcome);
					return true;
				} catch (e) {
					if (e instanceof UnsupportedDOMFeature) {
						stopDOM();
						reportDOM(true, { status: 'unsupported', message: e.message });
					} else reportDOM(false, e instanceof Error ? e.message : 'DOM operation failed');
					return false;
				}
			};
			if (operation.event) {
				const [selector, eventName] = operation.event.split('|');
				const trigger = root.querySelector(selector);
				if (!trigger) throw new Error('Invalid event binding');
				unbind.push(bindLiveDOMEvent(trigger, eventName, operation, input, execute));
			} else immediate.push(execute);
		}
		// Observers are ready even when declared after an immediate operation.
		for (const execute of immediate) if (!execute()) return;
		let probe: unknown;
		if (program.probe) {
			const p = program.probe;
			if (p.kind === 'element') probe = { element: p.name, interface: document.createElement(p.name).constructor.name };
			if (p.kind === 'attribute') {
				const el = root.querySelector(p.target || '#sample');
				probe = { attribute: p.name, value: el?.getAttribute(p.name), markup: el?.outerHTML.slice(0, 4000) };
			}
			if (p.kind === 'css')
				probe = {
					property: p.name,
					value: substitute(p.value || ''),
					supported: CSS.supports(p.name, substitute(p.value || '')),
					computed: root.querySelector('#sample') ? getComputedStyle(root.querySelector('#sample')!).getPropertyValue(p.name) : null
				};
			if (p.kind === 'selector') {
				const selector = substitute(p.name);
				probe = { selector, supported: CSS.supports(`selector(${selector})`), matches: root.querySelectorAll(selector).length };
			}
			if (p.kind === 'interface') {
				probe = inspectPlatformInterface(p.name, window);
			}
		}
		if (!program.steps?.length) {
			if (lastDOMResult?.ok === false) send(false, lastDOMResult.value);
			else send(true, probe ?? lastDOMResult?.value ?? { rendered: nodes, styles: program.styles?.length || 0, events: program.dom?.length || 0 });
			return;
		}
		// Compile data to a Blob module; neither eval nor Function is used. Infinite
		// loops/RegExps/getters run in a separate worker and are actually terminated.
		const source = compilePlatformWorker(program);
		const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
		const worker = new Worker(url);
		let bridge: ReturnType<typeof createPlatformDOMBridge> | undefined;
		const stop = runPlatformWorker(
			worker,
			input,
			(ok, value) => {
				lastDOMResult = undefined;
				send(ok, value);
			},
			() => {
				bridge?.stop();
				URL.revokeObjectURL(url);
			},
			(request) => (bridge ??= createPlatformDOMBridge(root)).request(request)
		);
		addEventListener('pagehide', stop, { once: true });
	} catch (e) {
		stopDOM();
		if (e instanceof UnsupportedDOMFeature) send(true, { status: 'unsupported', message: e.message });
		else send(false, e instanceof Error ? e.message : 'Invalid platform program');
	}
});
parent.postMessage({ type: 'tt-platform-ready' }, '*');
