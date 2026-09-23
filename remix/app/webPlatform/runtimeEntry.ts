import { compilePlatformProgram, validatePlatformProgram } from './compiler';
import { compilePlatformWorker } from './workerSource';
import type { PlatformNode } from './types';
let started = false;
addEventListener('message', (event) => {
	if (event.source !== parent || started || event.data?.type !== 'tt-platform-start') return;
	const { program: raw, input, runId } = event.data;
	if (typeof runId !== 'string' || runId.length > 80 || !input || typeof input !== 'object' || JSON.stringify(input).length > 16384) return;
	started = true;
	const send = (ok: boolean, result: unknown) =>
		parent.postMessage({ type: 'tt-platform-result', runId, ok, text: JSON.stringify(result, null, 2).slice(0, 65536) }, '*');
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
			for (const child of node.children || []) el.appendChild(render(child, depth + 1));
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
		const methods = new Set([
			'show',
			'showModal',
			'close',
			'showPopover',
			'hidePopover',
			'togglePopover',
			'focus',
			'blur',
			'click',
			'select',
			'checkValidity',
			'reportValidity',
			'reset',
			'requestSubmit',
			'stepUp',
			'stepDown',
			'scrollIntoView',
			'animate',
			'setAttribute',
			'removeAttribute',
			'toggleAttribute'
		]);
		const events = { used: 0 };
		for (const operation of program.dom || []) {
			if (!methods.has(operation.method)) throw new Error('This DOM method is not registered');
			const element = root.querySelector(operation.target) as any;
			if (!element) throw new Error(`No element matches ${operation.target}`);
			const execute = () => {
				try {
					if (++events.used > 200) throw new Error('Reset the demo to replenish its event budget');
					const args = (operation.args || []).map((v) => (typeof v === 'string' ? substitute(v) : v));
					if (operation.method === 'setAttribute' && /^(on|src|href|srcdoc|action|formaction|is|nonce|pattern)/i.test(String(args[0])))
						throw new Error('Attribute is not writable by this control');
					if (typeof element[operation.method] !== 'function') throw new Error('This browser does not implement the method');
					const result = element[operation.method](...args);
					send(true, { method: operation.method, result: typeof result === 'object' ? String(result) : result ?? null });
				} catch (e) {
					send(false, e instanceof Error ? e.message : 'DOM operation failed');
				}
			};
			if (operation.event) {
				const [selector, eventName] = operation.event.split('|');
				const trigger = root.querySelector(selector);
				if (!trigger || !['click', 'input', 'change', 'submit', 'toggle', 'focus', 'blur'].includes(eventName))
					throw new Error('Invalid event binding');
				trigger.addEventListener(eventName, execute);
			} else execute();
		}
		document.addEventListener('submit', (e) => e.preventDefault());
		document.addEventListener('click', (e) => {
			const a = (e.target as Element)?.closest?.('a');
			if (a && !a.getAttribute('href')?.startsWith('#')) e.preventDefault();
		});
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
				let value: any = window;
				for (const part of p.name.split('.')) {
					if (['__proto__', 'constructor'].includes(part)) throw new Error('Invalid inspection path');
					value = value?.[part];
				}
				probe = {
					interface: p.name,
					available: value !== undefined,
					type: typeof value,
					context: 'opaque-origin document',
					members: value ? Object.getOwnPropertyNames(value.prototype || value).slice(0, 100) : []
				};
			}
		}
		if (!program.steps?.length) {
			send(true, probe ?? { rendered: nodes, styles: program.styles?.length || 0, events: program.dom?.length || 0 });
			return;
		}
		// Compile data to a Blob module; neither eval nor Function is used. Infinite
		// loops/RegExps/getters run in a separate worker and are actually terminated.
		const source = compilePlatformWorker(program);
		const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
		const worker = new Worker(url);
		let done = false;
		const stop = () => {
			worker.terminate();
			URL.revokeObjectURL(url);
		};
		const timer = setTimeout(() => {
			if (done) return;
			done = true;
			stop();
			send(false, 'The program exceeded its 2-second execution limit.');
		}, 2000);
		worker.onmessage = (e) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			stop();
			send(e.data.ok === true, e.data.result);
		};
		worker.onerror = () => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			stop();
			send(false, 'The browser could not execute this program. Check feature support and the program definition.');
		};
		addEventListener(
			'pagehide',
			() => {
				clearTimeout(timer);
				stop();
			},
			{ once: true }
		);
		worker.postMessage(input);
	} catch (e) {
		send(false, e instanceof Error ? e.message : 'Invalid platform program');
	}
});
parent.postMessage({ type: 'tt-platform-ready' }, '*');
