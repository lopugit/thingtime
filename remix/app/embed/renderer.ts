import { parseThingPath, type JsonValue } from './json';

export type SafeMountOptions = {
	editable?: boolean;
	label?: string;
};

export type SafeRendererStore = {
	get(path?: string | Array<string | number>): JsonValue | undefined;
	set(path: string | Array<string | number> | undefined, value: unknown): void;
	subscribe(listener: () => void): () => void;
};

const STYLES = `
:host { color-scheme: light; display: block; contain: content; }
* { box-sizing: border-box; }
.tt-tree { color: #18181b; font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-width: 0; }
.tt-node { border-left: 1px solid #e4e4e7; margin: 4px 0 4px 7px; padding-left: 10px; min-width: 0; }
.tt-row { align-items: center; display: grid; gap: 8px; grid-template-columns: minmax(80px, .55fr) minmax(0, 1fr); min-height: 34px; }
.tt-key { color: #71717a; font: 600 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.tt-type { background: #f4f4f5; border-radius: 999px; color: #71717a; font-size: 10px; margin-left: 6px; padding: 2px 7px; }
.tt-value { color: #18181b; min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.tt-input { background: #fff; border: 1px solid #d4d4d8; border-radius: 8px; color: #18181b; font: inherit; min-width: 0; outline: none; padding: 6px 9px; width: 100%; }
.tt-input:focus { border-color: #a1a1aa; box-shadow: 0 0 0 3px rgba(24,24,27,.08); }
.tt-summary { align-items: center; cursor: pointer; display: flex; list-style: none; min-height: 30px; user-select: none; }
.tt-summary::-webkit-details-marker { display: none; }
.tt-summary::before { color: #a1a1aa; content: "▾"; font-size: 11px; margin-right: 7px; transform-origin: center; }
details:not([open]) > .tt-summary::before { transform: rotate(-90deg); }
.tt-empty { color: #a1a1aa; font-style: italic; padding: 7px 0; }
.tt-boolean { accent-color: #18181b; height: 17px; width: 17px; }
@media (max-width: 520px) { .tt-row { grid-template-columns: minmax(64px, .42fr) minmax(0, 1fr); } }
`;

const appendText = (parent: Element, className: string, text: string) => {
	const element = document.createElement('span');
	element.className = className;
	element.textContent = text;
	parent.appendChild(element);
	return element;
};

const typeName = (value: JsonValue | undefined) =>
	value === null ? 'null' : Array.isArray(value) ? 'array' : value === undefined ? 'missing' : typeof value;

export const createSafeThingMount = (
	target: Element,
	store: SafeRendererStore,
	path: string | Array<string | number> | undefined,
	options: SafeMountOptions = {},
	nonce?: string
) => {
	const host = document.createElement('div');
	host.className = 'thingtime-safe-mount';
	host.setAttribute('data-thingtime-safe-mount', '');
	target.appendChild(host);
	const shadow = host.attachShadow({ mode: 'open' });
	const style = document.createElement('style');
	if (nonce) style.nonce = nonce;
	style.textContent = STYLES;
	shadow.appendChild(style);
	const tree = document.createElement('div');
	tree.className = 'tt-tree';
	shadow.appendChild(tree);

	const renderNode = (parent: Element, value: JsonValue | undefined, nodePath: Array<string | number>, key: string, isRoot = false) => {
		const type = typeName(value);
		if (type === 'object' || type === 'array') {
			const details = document.createElement('details');
			details.className = isRoot ? 'tt-root' : 'tt-node';
			details.open = true;
			const summary = document.createElement('summary');
			summary.className = 'tt-summary';
			appendText(summary, 'tt-key', key);
			const count = Array.isArray(value) ? value.length : Object.keys((value || {}) as object).length;
			appendText(summary, 'tt-type', `${type} · ${count}`);
			details.appendChild(summary);

			const entries = Array.isArray(value) ? value.map((entry, index) => [String(index), entry] as const) : Object.entries(value || {});
			if (!entries.length) appendText(details, 'tt-empty', type === 'array' ? 'Empty list' : 'Empty thing');
			entries.forEach(([childKey, childValue]) => renderNode(details, childValue as JsonValue, [...nodePath, childKey], childKey));
			parent.appendChild(details);
			return;
		}

		const row = document.createElement('div');
		row.className = 'tt-node tt-row';
		appendText(row, 'tt-key', key);
		const valueCell = document.createElement('div');
		valueCell.className = 'tt-value';

		if (options.editable && type === 'boolean') {
			const input = document.createElement('input');
			input.className = 'tt-boolean';
			input.type = 'checkbox';
			input.checked = value === true;
			input.setAttribute('aria-label', key);
			input.addEventListener('change', () => store.set(nodePath, input.checked));
			valueCell.appendChild(input);
		} else if (options.editable && (type === 'string' || type === 'number')) {
			const input = document.createElement('input');
			input.className = 'tt-input';
			input.type = type === 'number' ? 'number' : 'text';
			input.value = String(value ?? '');
			input.setAttribute('aria-label', key);
			const commit = () => {
				if (type === 'number') {
					const parsed = Number(input.value);
					if (Number.isFinite(parsed)) store.set(nodePath, parsed);
				} else {
					store.set(nodePath, input.value);
				}
			};
			input.addEventListener('change', commit);
			input.addEventListener('blur', commit);
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					commit();
					input.blur();
				}
			});
			valueCell.appendChild(input);
		} else {
			valueCell.textContent = type === 'string' ? String(value) : JSON.stringify(value);
		}

		row.appendChild(valueCell);
		parent.appendChild(row);
	};

	const render = () => {
		tree.replaceChildren();
		renderNode(tree, store.get(path), parseThingPath(path), options.label || 'Thing', true);
	};
	const unsubscribe = store.subscribe(render);
	render();

	return {
		host,
		destroy() {
			unsubscribe();
			host.remove();
		}
	};
};
