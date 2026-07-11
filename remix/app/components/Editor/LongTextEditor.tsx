import React from 'react';
import { Box } from '@chakra-ui/react';

import { EDITOR_JS_HEADING_FONT_SIZES, EDITOR_JS_HEADING_LEVELS, getEditorJsValueSignature, isEditorJsDoc, isEditorJsDocSafeToEdit } from './editorJsValue';
import type { EditorJsDoc } from './editorJsValue';
import { inlineHtmlToText } from './inlineHtmlText';
import { StyleTune } from './StyleTune';

export { getEditorJsDoc, isEditorJsDoc, parseEditorJsDocString } from './editorJsValue';
export type { EditorJsBlock, EditorJsDoc } from './editorJsValue';

// LongTextEditor — Editor.js block editing for long-text values, everywhere.
//
// Two modes, decided by the value's shape (single source of truth: the data):
//  - string mode: a long plain string is converted to blocks for editing and
//    serialised back to a markdown-ish plain string on every change, so the
//    stored thing stays a friendly string. Paragraphs, "## " headings, "- "
//    lists, "- [x]" checklists, "> " quotes, "---" dividers, ``` code fences,
//    "| a | b |" tables, "![caption](url)" images, and "⚠️ title — message"
//    callouts all round-trip.
//  - block mode: a value that already is an Editor.js doc ({ blocks: [...] })
//    is edited natively and emitted back as { ...value, blocks } — this is the
//    'rich-text' kind, renderable read-only by the kind registry.
//
// The full practical Editor.js suite is available; the `blockTypes` prop lets
// any field enable/disable individual block + inline tools.
//
// Editor.js is browser-only, so the library and its tools load via dynamic
// import inside an effect; SSR and non-DOM environments never touch it.

export type LongTextValue = string | EditorJsDoc;

// every togglable tool: block tools + the extra inline tools
// (paragraph and the core bold/italic/link inline tools are always on)
export type LongTextBlockType =
	| 'header'
	| 'list'
	| 'checklist'
	| 'quote'
	| 'delimiter'
	| 'table'
	| 'code'
	| 'warning'
	| 'embed'
	| 'image'
	| 'marker'
	| 'inlineCode'
	| 'underline'
	// the 🎨 Style block tune (colour/size/font/align as validated tokens)
	| 'style';

// enable/disable any tool per field: absent or true = enabled
export type LongTextBlockTypes = Partial<Record<LongTextBlockType, boolean>>;

export const LONG_TEXT_BLOCK_TYPES: LongTextBlockType[] = [
	'header',
	'list',
	'checklist',
	'quote',
	'delimiter',
	'table',
	'code',
	'warning',
	'embed',
	'image',
	'marker',
	'inlineCode',
	'underline',
	'style'
];

// ————— inline html ↔ text (editor.js allows <b>/<i>/<a>/<mark>… inline) —————

const escapeInline = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ————— plain text → blocks —————

const TABLE_ROW = /^\|(.+)\|\s*$/;
const TABLE_SEPARATOR_CELL = /^\s*:?-{2,}:?\s*$/;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const WARNING_LINE = /^⚠️\s+(.+?)(?:\s+—\s+(.*))?$/;

const splitTableRow = (line: string): string[] =>
	line
		.replace(/^\||\|\s*$/g, '')
		.split('|')
		.map((cell) => cell.trim());

// parse one blank-line-delimited chunk of non-fence lines into blocks
const parseChunkLines = (lines: string[], blocks: EditorJsDoc['blocks']) => {
	let buffer: string[] = [];
	const flushParagraph = () => {
		if (buffer.length) {
			blocks.push({ type: 'paragraph', data: { text: escapeInline(buffer.join('\n')) } });
			buffer = [];
		}
	};

	let listRun: { ordered: boolean; items: string[] } | null = null;
	const flushList = () => {
		if (listRun) {
			blocks.push({ type: 'list', data: { style: listRun.ordered ? 'ordered' : 'unordered', items: listRun.items.map(escapeInline) } });
			listRun = null;
		}
	};

	let checklistRun: Array<{ text: string; checked: boolean }> | null = null;
	const flushChecklist = () => {
		if (checklistRun) {
			blocks.push({ type: 'checklist', data: { items: checklistRun.map((item) => ({ text: escapeInline(item.text), checked: item.checked })) } });
			checklistRun = null;
		}
	};

	let tableRun: string[][] | null = null;
	let tableHasHeadings = false;
	const flushTable = () => {
		if (tableRun && tableRun.length) {
			blocks.push({
				type: 'table',
				data: { withHeadings: tableHasHeadings, content: tableRun.map((row) => row.map(escapeInline)) }
			});
		}
		tableRun = null;
		tableHasHeadings = false;
	};

	const flushAll = () => {
		flushParagraph();
		flushList();
		flushChecklist();
		flushTable();
	};

	for (const line of lines) {
		const header = line.match(/^(#{1,6})\s+(.*)$/);
		const check = line.match(/^-\s\[( |x|X)\]\s+(.*)$/);
		const bullet = line.match(/^[-*]\s+(.*)$/);
		const ordered = line.match(/^\d+[.)]\s+(.*)$/);
		const quote = line.match(/^>\s?(.*)$/);
		const tableRow = line.match(TABLE_ROW);
		const image = line.match(IMAGE_LINE);
		const warning = line.match(WARNING_LINE);

		if (tableRow) {
			flushParagraph();
			flushList();
			flushChecklist();
			const cells = splitTableRow(line);
			if (tableRun && cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell))) {
				// markdown heading separator: marks the previous row as headings
				tableHasHeadings = true;
				continue;
			}
			tableRun = tableRun || [];
			tableRun.push(cells);
			continue;
		}
		flushTable();

		if (header) {
			flushAll();
			blocks.push({ type: 'header', data: { text: escapeInline(header[2]), level: Math.min(header[1].length, 6) } });
		} else if (line.trim() === '---') {
			flushAll();
			blocks.push({ type: 'delimiter', data: {} });
		} else if (image) {
			flushAll();
			blocks.push({ type: 'image', data: { url: image[2], caption: escapeInline(image[1]) } });
		} else if (warning && line.startsWith('⚠️')) {
			flushAll();
			blocks.push({ type: 'warning', data: { title: escapeInline(warning[1]), message: escapeInline(warning[2] || '') } });
		} else if (check) {
			flushParagraph();
			flushList();
			checklistRun = checklistRun || [];
			checklistRun.push({ text: check[2], checked: check[1].toLowerCase() === 'x' });
		} else if (bullet) {
			flushParagraph();
			flushChecklist();
			if (listRun && listRun.ordered) flushList();
			listRun = listRun || { ordered: false, items: [] };
			listRun.items.push(bullet[1]);
		} else if (ordered) {
			flushParagraph();
			flushChecklist();
			if (listRun && !listRun.ordered) flushList();
			listRun = listRun || { ordered: true, items: [] };
			listRun.items.push(ordered[1]);
		} else if (quote) {
			flushAll();
			blocks.push({ type: 'quote', data: { text: escapeInline(quote[1]), caption: '' } });
		} else {
			flushList();
			flushChecklist();
			buffer.push(line);
		}
	}

	flushAll();
};

export const textToBlocks = (text: string): EditorJsDoc['blocks'] => {
	const blocks: EditorJsDoc['blocks'] = [];
	const lines = text.split('\n');

	// fences first — code bodies may contain blank lines and block syntax
	let chunk: string[] = [];
	const flushChunk = () => {
		const meaningful = chunk.filter((line) => line.trim() !== '');
		if (meaningful.length) parseChunkLines(meaningful, blocks);
		chunk = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (/^```/.test(line.trim())) {
			flushChunk();
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
				codeLines.push(lines[i]);
				i++;
			}
			blocks.push({ type: 'code', data: { code: codeLines.join('\n') } });
			continue;
		}

		if (line.trim() === '') {
			flushChunk();
			continue;
		}

		chunk.push(line);
	}
	flushChunk();

	return blocks.length ? blocks : [{ type: 'paragraph', data: { text: escapeInline(text) } }];
};

// ————— blocks → plain text (the inverse) —————

const checklistItems = (data: Record<string, unknown>): Array<{ text: string; checked: boolean }> =>
	(Array.isArray(data.items) ? data.items : []).map((item) => {
		const record = (item || {}) as Record<string, unknown>;
		return { text: inlineHtmlToText(record.text ?? record.content ?? item), checked: record.checked === true };
	});

export const blocksToText = (blocks: EditorJsDoc['blocks']): string =>
	blocks
		.map((block) => {
			const data = block.data || {};
			if (block.type === 'header') {
				const level = Math.max(1, Math.min(6, Number(data.level) || 2));
				return `${'#'.repeat(level)} ${inlineHtmlToText(data.text)}`;
			}
			if (block.type === 'list') {
				// List v2 items are { content, meta: { checked }, items: [...] };
				// v1 items are plain strings — serialise both, nesting by indent
				const style = String(data.style ?? 'unordered');
				const serializeItems = (items: unknown[], depth: number): string =>
					items
						.map((item, idx) => {
							const record = (item || {}) as Record<string, unknown>;
							const meta = (record.meta || {}) as Record<string, unknown>;
							const text = inlineHtmlToText(typeof item === 'string' ? item : record.text ?? record.content);
							const indent = '  '.repeat(depth);
							const line =
								style === 'checklist'
									? `${indent}- [${record.checked === true || meta.checked === true ? 'x' : ' '}] ${text}`
									: style === 'ordered'
										? `${indent}${idx + 1}. ${text}`
										: `${indent}- ${text}`;
							const children = Array.isArray(record.items) && record.items.length ? `\n${serializeItems(record.items, depth + 1)}` : '';
							return line + children;
						})
						.join('\n');
				return serializeItems(Array.isArray(data.items) ? data.items : [], 0);
			}
			if (block.type === 'checklist') {
				return checklistItems(data)
					.map((item) => `- [${item.checked ? 'x' : ' '}] ${item.text}`)
					.join('\n');
			}
			if (block.type === 'quote') {
				const caption = inlineHtmlToText(data.caption);
				return `> ${inlineHtmlToText(data.text)}${caption ? `\n> — ${caption}` : ''}`;
			}
			if (block.type === 'delimiter') {
				return '---';
			}
			if (block.type === 'code') {
				return `\`\`\`\n${String(data.code ?? '')}\n\`\`\``;
			}
			if (block.type === 'table') {
				const content = (Array.isArray(data.content) ? data.content : []) as unknown[][];
				if (!content.length) return '';
				const rows = content.map((row) => `| ${(Array.isArray(row) ? row : []).map((cell) => inlineHtmlToText(cell)).join(' | ')} |`);
				if (data.withHeadings === true && content[0]) {
					rows.splice(1, 0, `| ${content[0].map(() => '---').join(' | ')} |`);
				}
				return rows.join('\n');
			}
			if (block.type === 'warning') {
				const title = inlineHtmlToText(data.title);
				const message = inlineHtmlToText(data.message);
				return `⚠️ ${title}${message ? ` — ${message}` : ''}`;
			}
			if (block.type === 'image') {
				const file = (data.file || {}) as Record<string, unknown>;
				const url = String(data.url ?? file.url ?? '');
				if (!url) return inlineHtmlToText(data.caption);
				return `![${inlineHtmlToText(data.caption)}](${url})`;
			}
			if (block.type === 'embed') {
				const source = String(data.source ?? data.embed ?? '');
				const caption = inlineHtmlToText(data.caption);
				return source ? `${source}${caption ? `\n${caption}` : ''}` : caption;
			}
			return inlineHtmlToText(data.text);
		})
		.filter((piece) => piece.trim() !== '')
		.join('\n\n');

// ————— the component —————

export type LongTextEditorProps = {
	value: LongTextValue;
	onValueChange?: (next: LongTextValue) => void;
	placeholder?: string;
	minHeight?: string;
	// editor.js native read-only mode: same block layout, no editing chrome.
	// Live-toggleable — the docs View/Edit switch flips it on the fly.
	readonly?: boolean;
	// enable/disable individual tools for this field (absent/true = enabled)
	blockTypes?: LongTextBlockTypes;
};

const LongTextEditorInner = (props: LongTextEditorProps) => {
	const holderRef = React.useRef<HTMLDivElement | null>(null);
	const editorRef = React.useRef<any>(null);
	const destroyedRef = React.useRef(false);
	// the mode is fixed at mount by the incoming value's shape
	const blockModeRef = React.useRef(isEditorJsDoc(props.value));
	const valueRef = React.useRef(props.value);
	const onChangeRef = React.useRef(props.onValueChange);
	const readonlyRef = React.useRef(Boolean(props.readonly));
	const blockTypesRef = React.useRef(props.blockTypes);
	// remember the last text we emitted so prop echoes don't reset the editor
	const lastEmittedRef = React.useRef<string | null>(null);
	const rawInputCleanupRef = React.useRef<(() => void) | null>(null);

	React.useEffect(() => {
		valueRef.current = props.value;
		onChangeRef.current = props.onValueChange;
		blockTypesRef.current = props.blockTypes;
	});

	// flip editor.js read-only mode when the prop changes after mount
	React.useEffect(() => {
		readonlyRef.current = Boolean(props.readonly);
		const editor = editorRef.current;
		if (!editor) return;
		Promise.resolve(editor.isReady)
			.then(() => {
				if (destroyedRef.current || !editorRef.current) return;
				if (editor.readOnly && editor.readOnly.isEnabled !== readonlyRef.current) {
					return editor.readOnly.toggle(readonlyRef.current);
				}
			})
			.catch(() => {});
	}, [props.readonly]);

	React.useEffect(() => {
		destroyedRef.current = false;
		let cancelled = false;

		(async () => {
			if (!holderRef.current) return;

			const [
				{ default: EditorJS },
				{ default: Header },
				{ default: List },
				{ default: Quote },
				{ default: Checklist },
				{ default: Delimiter },
				{ default: Table },
				{ default: CodeTool },
				{ default: Warning },
				{ default: Embed },
				{ default: SimpleImage },
				{ default: Marker },
				{ default: InlineCode },
				{ default: Underline }
			] = await Promise.all([
				import('@editorjs/editorjs'),
				import('@editorjs/header'),
				import('@editorjs/list'),
				import('@editorjs/quote'),
				import('@editorjs/checklist'),
				import('@editorjs/delimiter'),
				import('@editorjs/table'),
				import('@editorjs/code'),
				import('@editorjs/warning'),
				import('@editorjs/embed'),
				import('@editorjs/simple-image'),
				import('@editorjs/marker'),
				import('@editorjs/inline-code'),
				import('@editorjs/underline')
			]);

			if (cancelled || !holderRef.current) return;

			const initial = valueRef.current;
			const blocks = isEditorJsDoc(initial) ? initial.blocks : textToBlocks(String(initial ?? ''));

			const enabled = (tool: LongTextBlockType) => blockTypesRef.current?.[tool] !== false;

			const tools: Record<string, unknown> = {
				...(enabled('header') ? { header: { class: Header as any, inlineToolbar: true, config: { levels: [...EDITOR_JS_HEADING_LEVELS], defaultLevel: 2 } } } : {}),
				...(enabled('list') ? { list: { class: List as any, inlineToolbar: true } } : {}),
				...(enabled('quote') ? { quote: { class: Quote as any, inlineToolbar: true } } : {}),
				...(enabled('checklist') ? { checklist: { class: Checklist as any, inlineToolbar: true } } : {}),
				...(enabled('delimiter') ? { delimiter: Delimiter as any } : {}),
				...(enabled('table') ? { table: { class: Table as any, inlineToolbar: true } } : {}),
				...(enabled('code') ? { code: CodeTool as any } : {}),
				...(enabled('warning')
					? { warning: { class: Warning as any, inlineToolbar: true, config: { titlePlaceholder: 'Heads up', messagePlaceholder: 'What should people know?' } } }
					: {}),
				...(enabled('embed') ? { embed: Embed as any } : {}),
				...(enabled('image') ? { image: SimpleImage as any } : {}),
				...(enabled('marker') ? { marker: Marker as any } : {}),
				...(enabled('inlineCode') ? { inlineCode: InlineCode as any } : {}),
				...(enabled('underline') ? { underline: Underline as any } : {}),
				...(enabled('style') ? { style: StyleTune as any } : {})
			};

			const editor = new EditorJS({
				holder: holderRef.current,
				data: { blocks },
				placeholder: props.placeholder || 'Imagine..',
				minHeight: 0,
				readOnly: readonlyRef.current,
				tools: tools as any,
				// the 🎨 Style tune rides every block's settings menu
				...(enabled('style') ? { tunes: ['style'] } : {}),
				onChange: async () => {
					try {
						const saved = await editor.save();
						if (destroyedRef.current) return;
						if (blockModeRef.current) {
							const base = isEditorJsDoc(valueRef.current) ? valueRef.current : {};
							onChangeRef.current?.({ ...base, blocks: saved.blocks } as EditorJsDoc);
						} else {
							const text = blocksToText(saved.blocks as EditorJsDoc['blocks']);
							lastEmittedRef.current = text;
							onChangeRef.current?.(text);
						}
					} catch {
						// a save during teardown is fine to drop
					}
				}
			});

			editorRef.current = editor;
			await editor.isReady;

			if (cancelled) {
				editor.destroy?.();
				editorRef.current = null;
				return;
			}

			// register in the window.meta debug db (same convention as
			// Thingtime.tsx) so devtools/tests can drive editor.js's own API
			try {
				const meta = ((window as any).meta = (window as any).meta || {});
				meta.editors = meta.editors || [];
				meta.editors.push(editor);
			} catch {
				// nothing
			}

			// fallback save on raw input events: editor.js's own change tracking
			// misses some programmatic/IME mutations — a debounced save on the
			// holder catches them (double saves are harmless: same serialisation)
			let inputDebounce: ReturnType<typeof setTimeout> | undefined;
			const onRawInput = () => {
				clearTimeout(inputDebounce);
				inputDebounce = setTimeout(async () => {
					try {
						const saved = await editor.save();
						if (destroyedRef.current) return;
						if (blockModeRef.current) {
							const base = isEditorJsDoc(valueRef.current) ? valueRef.current : {};
							onChangeRef.current?.({ ...base, blocks: saved.blocks } as EditorJsDoc);
						} else {
							const text = blocksToText(saved.blocks as EditorJsDoc['blocks']);
							lastEmittedRef.current = text;
							onChangeRef.current?.(text);
						}
					} catch {
						// a save during teardown is fine to drop
					}
				}, 250);
			};
			holderRef.current?.addEventListener('input', onRawInput);
			rawInputCleanupRef.current = () => {
				clearTimeout(inputDebounce);
				holderRef.current?.removeEventListener('input', onRawInput);
			};
		})();

		return () => {
			cancelled = true;
			destroyedRef.current = true;
			rawInputCleanupRef.current?.();
			rawInputCleanupRef.current = null;
			const editor = editorRef.current;
			editorRef.current = null;
			if (editor) {
				try {
					const meta = (window as any).meta;
					if (meta?.editors) meta.editors = meta.editors.filter((item: unknown) => item !== editor);
				} catch {
					// nothing
				}
				Promise.resolve(editor.isReady)
					.then(() => editor.destroy?.())
					.catch(() => {});
			}
		};
		// mount-once by design: the editor owns the value while it exists;
		// external replacements remount via the key the caller provides
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<Box
			className="long-text-editor"
			ref={holderRef}
			width="100%"
			minHeight={props.minHeight || '96px'}
			padding="10px 12px"
			background="var(--tt-card, #ffffff)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			transition="border-color 0.15s ease, box-shadow 0.15s ease"
			fontSize="15px"
			_focusWithin={{
				borderColor: 'var(--tt-faint, #b6b6c0)',
				boxShadow: '0 0 0 3px var(--tt-accent-tint, #fff5fa)'
			}}
			sx={{
				// keep editor.js chrome inside our card look
				// Wide Editor.js positions its 58px + / settings action row to the
				// left of block content. Reserve that gutter inside the editor;
				// narrow mode moves the controls itself and must keep the full width.
				'@media screen and (min-width: 651px)': {
					'.codex-editor:not(.codex-editor--narrow)': { paddingInlineStart: '58px' },
					'.codex-editor:not(.codex-editor--narrow) .ce-toolbar': {
						insetInlineStart: '58px',
						width: 'calc(100% - 58px)'
					}
				},
				'.codex-editor__redactor': { paddingBottom: '0 !important' },
				'.ce-block__content, .ce-toolbar__content': { maxWidth: '100%' },
				'.ce-toolbar__plus, .ce-toolbar__settings-btn': { color: 'var(--tt-muted, #9a9aa6)' },
				'.ce-paragraph[data-placeholder]:empty::before': { color: 'var(--tt-faint, #b6b6c0)' },
				'h1.ce-header, h2.ce-header, h3.ce-header, h4.ce-header, h5.ce-header, h6.ce-header': {
					fontWeight: 800,
					lineHeight: 1.25
				},
				'h1.ce-header': { fontSize: `var(--tt-editor-heading-font-size, ${EDITOR_JS_HEADING_FONT_SIZES[1]})` },
				'h2.ce-header': { fontSize: `var(--tt-editor-heading-font-size, ${EDITOR_JS_HEADING_FONT_SIZES[2]})` },
				'h3.ce-header': { fontSize: `var(--tt-editor-heading-font-size, ${EDITOR_JS_HEADING_FONT_SIZES[3]})` },
				'h4.ce-header': { fontSize: `var(--tt-editor-heading-font-size, ${EDITOR_JS_HEADING_FONT_SIZES[4]})` },
				'h5.ce-header': { fontSize: `var(--tt-editor-heading-font-size, ${EDITOR_JS_HEADING_FONT_SIZES[5]})` },
				'h6.ce-header': { fontSize: `var(--tt-editor-heading-font-size, ${EDITOR_JS_HEADING_FONT_SIZES[6]})` },
				// quotes should look like quotes, not bordered boxes: kill the
				// stock cdx-input chrome + ~160px min-height, use the accent rule
				'.cdx-quote__text': {
					minHeight: '0 !important',
					border: 'none',
					boxShadow: 'none',
					borderRadius: 0,
					borderLeft: '3px solid var(--tt-accent, hotpink)',
					padding: '2px 0 2px 12px',
					fontStyle: 'italic',
					color: 'var(--tt-ink, #16161a)'
				},
				'.cdx-quote__caption': {
					border: 'none',
					boxShadow: 'none',
					padding: '2px 0 0 15px',
					fontSize: '12px',
					color: 'var(--tt-muted, #9a9aa6)'
				},
				'.cdx-quote__caption[data-placeholder]:empty::before': { color: 'var(--tt-faint, #b6b6c0)', opacity: 0.8 },
				// code blocks: mono, calm, ours
				'.ce-code__textarea': {
					background: 'var(--tt-ink, #16161a)',
					color: '#e6e6ea',
					border: 'none',
					borderRadius: 'var(--tt-radius-sm, 9px)',
					fontFamily: 'var(--tt-font-mono, monospace)',
					fontSize: '12.5px',
					minHeight: '80px'
				},
				// tables inherit theme borders
				'.tc-table, .tc-row, .tc-cell': { borderColor: 'var(--tt-border, #ececef)' },
				'.tc-cell': { fontSize: '14px' }
			}}
		/>
	);
};

// Outer wrapper: changing `blockTypes` needs an editor re-init (editor.js
// cannot swap tools live), so we remount the inner editor keyed by the
// enabled-tool set while carrying the latest edited value across the remount.
const EditableLongTextEditor = (props: LongTextEditorProps) => {
	const latestRef = React.useRef<LongTextValue | null>(null);
	const valueMode = isEditorJsDoc(props.value) ? 'blocks' : 'string';
	const valueModeRef = React.useRef(valueMode);
	const incomingSignature = getEditorJsValueSignature(props.value);
	const incomingSignatureRef = React.useRef(incomingSignature);
	const latestSignatureRef = React.useRef(incomingSignature);
	const pendingEmittedSignaturesRef = React.useRef<string[]>([]);
	const externalRevisionRef = React.useRef(0);

	// A caller can explicitly convert string <-> Editor.js while this wrapper
	// remains mounted. Reset the carried value and remount the inner editor so
	// its mount-fixed output mode always matches the persisted representation.
	if (valueModeRef.current !== valueMode) {
		valueModeRef.current = valueMode;
		latestRef.current = props.value;
	}

	// Editor.js owns its live document, so normal parent echoes of handleChange
	// must not reset it. A genuinely different incoming value (Paste, Apply
	// template, undo, remote sync, etc.) must remount, even when it has the same
	// string/blocks representation, otherwise the stale editor can overwrite it
	// on the next keystroke.
	if (incomingSignatureRef.current !== incomingSignature) {
		incomingSignatureRef.current = incomingSignature;
		const pending = pendingEmittedSignaturesRef.current;
		const echoIndex = pending.indexOf(incomingSignature);
		const pendingEcho = echoIndex >= 0;

		if (!pendingEcho) {
			pending.length = 0;
			latestRef.current = props.value;
			latestSignatureRef.current = incomingSignature;
			externalRevisionRef.current += 1;
		} else {
			// Acknowledging an emitted value also retires every older edit. Keep
			// newer unacknowledged values live so a delayed parent echo cannot
			// roll the editor back.
			pending.splice(0, echoIndex + 1);
			if (latestSignatureRef.current === incomingSignature) latestRef.current = props.value;
		}
	}

	const configKey = `${valueMode}:${externalRevisionRef.current}:${LONG_TEXT_BLOCK_TYPES.filter((tool) => props.blockTypes?.[tool] !== false).join(',')}`;
	const onValueChange = props.onValueChange;

	const handleChange = React.useCallback(
		(next: LongTextValue) => {
			const signature = getEditorJsValueSignature(next);
			latestRef.current = next;
			latestSignatureRef.current = signature;
			const pending = pendingEmittedSignaturesRef.current;
			const duplicateIndex = pending.indexOf(signature);
			if (duplicateIndex >= 0) pending.splice(duplicateIndex, 1);
			pending.push(signature);
			if (pending.length > 32) pending.splice(0, pending.length - 32);
			onValueChange?.(next);
		},
		[onValueChange]
	);

	return <LongTextEditorInner {...props} key={configKey} value={latestRef.current ?? props.value} onValueChange={handleChange} />;
};

export const LongTextEditor = (props: LongTextEditorProps) => {
	if (isEditorJsDoc(props.value) && !isEditorJsDocSafeToEdit(props.value)) {
		return (
			<Box
				role="note"
				width="100%"
				padding="12px"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-md, 12px)"
				color="var(--tt-muted, #9a9aa6)"
				fontSize="13px"
			>
				This Editor.js document is too large or deeply nested for safe editing. Its complete value is preserved; use view mode for a bounded preview.
			</Box>
		);
	}

	return <EditableLongTextEditor {...props} />;
};
