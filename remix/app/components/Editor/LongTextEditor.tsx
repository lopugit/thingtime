import React from 'react';
import { Box } from '@chakra-ui/react';
import { Global } from '@emotion/react';

import {
	blocksToText,
	EDITOR_JS_HEADING_FONT_SIZES,
	EDITOR_JS_HEADING_LEVELS,
	getEditorJsValueSignature,
	isEditorJsDoc,
	isEditorJsDocSafeToEdit
} from './editorJsValue';
import type { EditorJsDoc } from './editorJsValue';
import { createOrderedEditorJsChangeQueue } from './editorJsChangeQueue';
import type { OrderedEditorJsChangeQueue } from './editorJsChangeQueue';
import { acknowledgeLatestEditorJsEcho, shouldAcceptEditorJsSnapshot } from './editorJsChangeReconciliation';
import type { EditorJsSourceRevision } from './editorJsChangeReconciliation';
import { watchEditorJsTextFieldKeydowns } from './editorJsKeyboard';
import { watchEditorJsBlockReorder } from './editorJsBlockDragDrop';
import { watchEditorJsPopoverViewport } from './editorJsPopoverViewport';
import { filterListV2ChecklistToolbox } from './editorJsToolbox';
import { getEditorJsTouchFocusTarget } from './editorJsTouchFocus';
import { StyleTune } from './StyleTune';
import { InlineStyle } from './InlineStyle';
import { watchEditorJsInlinePosition } from './editorJsInlinePosition';
import { EditorHistory } from './editorHistory';
import { EditorHistoryControls, type EditorHistoryHandle, type HistoryAction } from './EditorHistoryControls';
import { watchEditorStyleCarry, type StyleCarryPreferences } from './editorStyleCarry';
import { watchEditorBlockChrome } from './editorBlockChrome';
import { useLopu } from '../Lopu/useLopu';
import { captureEditorDraft } from './editorDraftSnapshot';

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

export type LongTextEditorHandle = {
	save: () => Promise<LongTextValue>;
};

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

// blocks → plain text now lives in editorJsValue (a light, editor-free module
// preview surfaces can import). Re-exported here (from the local import above)
// for existing importers, e.g. Thingtime, that reach it through LongTextEditor.
export { blocksToText };

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
	/** Optional owner-scoped history keeps branches across an editor closing/reopening. */
	history?: EditorHistory;
};

type SequencedLongTextValue = {
	value: LongTextValue;
	sequence: number;
	doc: EditorJsDoc;
	label?: string;
	epoch: number;
};

type LongTextEditorInnerProps = Omit<LongTextEditorProps, 'onValueChange'> & {
	onValueChange?: (next: LongTextValue, sequence: number, doc: EditorJsDoc, label?: string) => void;
	allocateChangeSequence: () => number;
	history: EditorHistory;
	carryPreferences: StyleCarryPreferences;
	seedDoc?: EditorJsDoc;
};

const LongTextEditorInner = React.forwardRef<LongTextEditorHandle & EditorHistoryHandle, LongTextEditorInnerProps>((props, ref) => {
	const holderRef = React.useRef<HTMLDivElement | null>(null);
	const editorRef = React.useRef<any>(null);
	const destroyedRef = React.useRef(false);
	// the mode is fixed at mount by the incoming value's shape
	const blockModeRef = React.useRef(isEditorJsDoc(props.value));
	const valueRef = React.useRef(props.value);
	const onChangeRef = React.useRef(props.onValueChange);
	const readonlyRef = React.useRef(Boolean(props.readonly));
	const blockTypesRef = React.useRef(props.blockTypes);
	const rawInputCleanupRef = React.useRef<(() => void) | null>(null);
	const saveCurrentValueRef = React.useRef<() => Promise<LongTextValue>>(async () => valueRef.current);
	const restoreRef = React.useRef<(doc: EditorJsDoc) => Promise<void>>(async () => {});
	const carryPreferencesRef = React.useRef(props.carryPreferences);
	carryPreferencesRef.current = props.carryPreferences;

	React.useImperativeHandle(
		ref,
		() => ({
			save: () => saveCurrentValueRef.current(),
			flush: async () => {
				await saveCurrentValueRef.current();
			},
			restore: (doc) => restoreRef.current(doc)
		}),
		[]
	);

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
		const mountedHolder = holderRef.current;
		let cancelled = false;
		let textFieldKeyboardCleanup: (() => void) | undefined;
		let blockReorderCleanup: (() => void) | undefined;
		let inlinePositionCleanup: (() => void) | undefined;
		let popoverViewportCleanup: (() => void) | undefined;
		let carryCleanup: (() => void) | undefined;
		let chromeCleanup: (() => void) | undefined;
		let mutationCleanup: (() => void) | undefined;
		let epoch = 0,
			restoring = false,
			ready = false;
		let captureError: unknown;
		let pendingCaptures: Promise<unknown> = Promise.resolve();
		let editorChangeQueue: OrderedEditorJsChangeQueue<SequencedLongTextValue> | undefined;
		let saveEditorValue: ((label?: string) => void) | undefined;

		(async () => {
			if (!holderRef.current) return;
			popoverViewportCleanup = watchEditorJsPopoverViewport(holderRef.current);
			inlinePositionCleanup = watchEditorJsInlinePosition(holderRef.current);

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
			const editorBlocks = (props.seedDoc?.blocks ?? blocks).map((block, index) => ({
				...block,
				...(!block.id && props.history.current?.doc.blocks[index]?.type === block.type ? { id: props.history.current.doc.blocks[index].id } : {})
			}));

			const enabled = (tool: LongTextBlockType) => blockTypesRef.current?.[tool] !== false;
			// List v2 also advertises a Checklist toolbox alias. Keep the legacy
			// checklist tool as the one direct insertion/conversion target so the
			// toolbox has one Checklist and existing checklist blocks stay stable.
			const listToolbox = filterListV2ChecklistToolbox((List as any).toolbox);

			const tools: Record<string, unknown> = {
				...(enabled('header')
					? { header: { class: Header as any, inlineToolbar: true, config: { levels: [...EDITOR_JS_HEADING_LEVELS], defaultLevel: 2 } } }
					: {}),
				...(enabled('list') ? { list: { class: List as any, inlineToolbar: true, toolbox: listToolbox } } : {}),
				...(enabled('quote') ? { quote: { class: Quote as any, inlineToolbar: true } } : {}),
				...(enabled('checklist') ? { checklist: { class: Checklist as any, inlineToolbar: true } } : {}),
				...(enabled('delimiter') ? { delimiter: Delimiter as any } : {}),
				...(enabled('table') ? { table: { class: Table as any, inlineToolbar: true } } : {}),
				...(enabled('code') ? { code: CodeTool as any } : {}),
				...(enabled('warning')
					? {
							warning: {
								class: Warning as any,
								inlineToolbar: true,
								config: { titlePlaceholder: 'Heads up', messagePlaceholder: 'What should people know?' }
							}
					  }
					: {}),
				...(enabled('embed') ? { embed: { class: Embed as any, inlineToolbar: true } } : {}),
				...(enabled('image') ? { image: { class: SimpleImage as any, inlineToolbar: true } } : {}),
				...(enabled('marker') ? { marker: Marker as any } : {}),
				...(enabled('inlineCode') ? { inlineCode: InlineCode as any } : {}),
				...(enabled('underline') ? { underline: Underline as any } : {}),
				...(enabled('style') ? { style: StyleTune as any, textStyle: InlineStyle as any } : {})
			};

			// Editor.js's ReadOnly module clears the DOCUMENT selection while a new
			// instance prepares (ReadOnly.toggleReadOnly → removeAllRanges). With
			// several editors live-syncing one store path (the composer's in-post
			// editor + its popout), an echo remounts the non-typing instance and
			// that global wipe eats the typist's caret mid-keystroke — focus stays
			// on their block but the next keys land at its start. Capture a
			// selection that lives OUTSIDE this holder before init and put it back
			// after isReady (only if still wiped and still attached, so a user who
			// re-clicked meanwhile is never fought).
			const foreignSelection = (() => {
				const selection = window.getSelection();
				if (!selection || selection.rangeCount === 0) return null;
				const range = selection.getRangeAt(0);
				if (holderRef.current?.contains(range.startContainer)) return null;
				return range.cloneRange();
			})();
			const restoreForeignSelection = () => {
				if (!foreignSelection || !foreignSelection.startContainer.isConnected) return;
				const selection = window.getSelection();
				// rangeCount > 0 means someone re-established a caret after the wipe
				// (the user clicked, or — version-dependent — Editor.js placed one in
				// its own holder); fighting it risks worse than the wipe. Empirically
				// our Editor.js build leaves the selection cleared, so this restores.
				if (selection && selection.rangeCount === 0) selection.addRange(foreignSelection);
			};

			let editor: any;
			editorChangeQueue = createOrderedEditorJsChangeQueue<SequencedLongTextValue, string>({
				getSignature: (snapshot) => `${snapshot.epoch}:${getEditorJsValueSignature(snapshot.doc)}`,
				onEmit: (snapshot) => {
					if (snapshot.epoch !== epoch) return;
					captureError = undefined;
					valueRef.current = snapshot.value;
					onChangeRef.current?.(snapshot.value, snapshot.sequence, snapshot.doc, snapshot.label);
				},
				onError: (error) => {
					if (!captureError) holderRef.current?.dispatchEvent(new CustomEvent('tt-editor-history-error', { bubbles: true }));
					captureError = error;
				}
			});

			saveEditorValue = (label) => {
				if (!editor || destroyedRef.current || restoring || !ready) return;
				const sequence = props.allocateChangeSequence();
				const captureEpoch = epoch;
				const saved = captureEditorDraft(editor);
				const capture = Promise.resolve(saved).then(({ doc, submitted }) => ({
					doc,
					value: blockModeRef.current
						? { ...(isEditorJsDoc(valueRef.current) ? valueRef.current : {}), blocks: submitted.blocks }
						: blocksToText(submitted.blocks),
					sequence,
					label,
					epoch: captureEpoch
				}));
				editorChangeQueue?.enqueue(async () => {
					return await capture;
				});
				pendingCaptures = Promise.allSettled([pendingCaptures, capture]);
			};
			saveCurrentValueRef.current = async () => {
				saveEditorValue?.();
				await pendingCaptures;
				if (captureError) throw captureError;
				return valueRef.current;
			};
			restoreRef.current = async (doc) => {
				await editor.isReady;
				if (destroyedRef.current) return;
				const active = document.activeElement;
				const shouldFocus = holderRef.current?.closest('.tt-editor-session')?.contains(active);
				const index = Math.max(0, editor.blocks.getCurrentBlockIndex());
				const activeBlock = editor.blocks.getBlockByIndex(index);
				const fieldIndex = activeBlock ? Array.from(activeBlock.holder.querySelectorAll('[contenteditable],textarea')).indexOf(active) : 0;
				epoch++;
				restoring = true;
				if (holderRef.current) holderRef.current.dataset.ttRestoring = 'true';
				try {
					// Tools may normalise their input in place. Never expose journal snapshots to them.
					await editor.blocks.render(JSON.parse(JSON.stringify(doc)));
				} finally {
					restoring = false;
					if (holderRef.current) delete holderRef.current.dataset.ttRestoring;
				}
				saveEditorValue?.();
				await pendingCaptures;
				if (shouldFocus) {
					const block = editor.blocks.getById(activeBlock?.id) || editor.blocks.getBlockByIndex(Math.min(index, editor.blocks.getBlocksCount() - 1));
					const fields = block?.holder.querySelectorAll('[contenteditable],textarea');
					const field = fields?.[Math.max(0, fieldIndex)] || fields?.[0];
					if (field) {
						field.focus({ preventScroll: true });
						const range = document.createRange();
						range.selectNodeContents(field);
						range.collapse(false);
						const selection = window.getSelection();
						selection?.removeAllRanges();
						selection?.addRange(range);
					}
				}
			};

			editor = new EditorJS({
				holder: holderRef.current,
				data: { blocks: editorBlocks },
				placeholder: props.placeholder || 'Imagine..',
				minHeight: 0,
				readOnly: readonlyRef.current,
				tools: tools as any,
				inlineToolbar: [
					'bold',
					'italic',
					'link',
					...(enabled('style') ? ['textStyle'] : []),
					...(enabled('underline') ? ['underline'] : []),
					...(enabled('marker') ? ['marker'] : []),
					...(enabled('inlineCode') ? ['inlineCode'] : [])
				],
				// the 🎨 Style tune rides every block's settings menu
				...(enabled('style') ? { tunes: ['style'] } : {}),
				onChange: () => {
					saveEditorValue?.();
				}
			});

			editorRef.current = editor;
			await editor.isReady;

			if (cancelled) {
				// a superseded init still wiped the document selection — restore
				// AFTER its teardown so destroy can't re-clear what we put back
				editor.destroy?.();
				editorRef.current = null;
				restoreForeignSelection();
				return;
			}

			restoreForeignSelection();
			props.history.record((await captureEditorDraft(editor)).doc, 'Document opened or replaced');
			ready = true;
			StyleTune.bindHolder(holderRef.current);
			carryCleanup = watchEditorStyleCarry(
				holderRef.current,
				(id, tokens) => {
					StyleTune.replaceForBlock(holderRef.current!, id, tokens);
					saveEditorValue?.('Change block type');
				},
				() => carryPreferencesRef.current
			);
			chromeCleanup = watchEditorBlockChrome(holderRef.current, () => editor);
			const mutationObserver = new MutationObserver(() => {
				if (holderRef.current) StyleTune.bindHolder(holderRef.current);
				saveEditorValue?.();
			});
			mutationObserver.observe(holderRef.current.querySelector('.codex-editor__redactor')!, {
				subtree: true,
				childList: true,
				attributes: true,
				attributeFilter: ['style', 'data-checked', 'class']
			});
			mutationCleanup = () => mutationObserver.disconnect();

			// Editor.js's block listener mistakes empty internal lines in tool
			// textboxes for block boundaries. Bind before that outer listener so
			// the browser keeps native deletion and cursor movement in the field.
			textFieldKeyboardCleanup = watchEditorJsTextFieldKeydowns(holderRef.current);

			// Block reordering: drag / long-press the six-dot grip, or Alt+↑/↓.
			// Explicitly settle one save after each completed move — Editor.js does
			// not reliably emit onChange for programmatic blocks.move().
			blockReorderCleanup = watchEditorJsBlockReorder(holderRef.current, () => editorRef.current, {
				onMoved: () => saveEditorValue?.()
			});

			// register in the window.meta debug db (same convention as
			// Thingtime.tsx) so devtools/tests can drive editor.js's own API
			try {
				const meta = ((window as any).meta = (window as any).meta || {});
				meta.editors = meta.editors || [];
				meta.editors.push(editor);
			} catch {
				// nothing
			}

			// Fallback for programmatic/IME mutations that Editor.js misses. Always
			// capture the final raw-input snapshot: the ordered queue removes the
			// adjacent duplicate when Editor.js also reported the same mutation.
			const onRawInput = (event: Event) => saveEditorValue?.(event instanceof CustomEvent ? event.detail?.label : undefined);
			holderRef.current?.addEventListener('input', onRawInput);
			holderRef.current?.addEventListener('tt-editor-change', onRawInput);
			rawInputCleanupRef.current = () => {
				holderRef.current?.removeEventListener('input', onRawInput);
				holderRef.current?.removeEventListener('tt-editor-change', onRawInput);
			};
		})();

		return () => {
			cancelled = true;
			saveCurrentValueRef.current = async () => valueRef.current;
			popoverViewportCleanup?.();
			inlinePositionCleanup?.();
			carryCleanup?.();
			chromeCleanup?.();
			mutationCleanup?.();
			if (mountedHolder) StyleTune.release(mountedHolder);
			// Capture the final DOM state before teardown, then allow already-started
			// saves to drain. The outer wrapper rejects stale results after an explicit
			// value replacement while preserving edits across tool-config remounts.
			saveEditorValue?.();
			const drained = editorChangeQueue?.close() ?? Promise.resolve();
			destroyedRef.current = true;
			textFieldKeyboardCleanup?.();
			blockReorderCleanup?.();
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
				Promise.all([Promise.resolve(editor.isReady), drained])
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
			// anchor for the block-reorder drop indicator (absolute child)
			position="relative"
			onPointerUp={(event) => {
				if (readonlyRef.current) return;
				const holder = event.currentTarget;
				const editable = getEditorJsTouchFocusTarget(holder, event.target, event.pointerType, holder.ownerDocument.activeElement);
				editable?.focus({ preventScroll: true });
			}}
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
				'--tt-editor-popover-edge-gap': '8px',
				// keep editor.js chrome inside our card look
				'.codex-editor': { paddingInlineStart: '0 !important' },
				// Raise open menus above history without blocking history while typing.
				'.codex-editor:has(.ce-popover--opened:not(.ce-popover--inline))': { zIndex: 9 },
				// Document typography must not enlarge or decorate editor controls.
				'.ce-toolbar, .ce-inline-toolbar': {
					fontSize: '14px',
					fontWeight: 400,
					lineHeight: 1.4,
					textAlign: 'left',
					letterSpacing: 'normal',
					textTransform: 'none'
				},
				'.ce-inline-toolbar button[aria-label="Text style"]': { fontSize: '20px', lineHeight: 1 },
				'.codex-editor .ce-toolbar': { left: '0 !important', right: '0 !important', width: '100% !important' },
				'.ce-toolbar__content': { position: 'relative' },
				'.codex-editor .ce-toolbar__actions': {
					position: 'absolute',
					left: '0',
					right: 'auto',
					top: '-30px',
					bottom: 'auto',
					padding: '0 !important',
					background: 'var(--tt-card,#fff)',
					borderRadius: '8px'
				},
				// Our actions float, so narrow desktop editors need no 50px gutter.
				'.codex-editor__redactor': { paddingBottom: '0 !important', margin: '0 !important' },
				'.ce-block__content, .ce-toolbar__content': { maxWidth: '100%' },
				'.ce-toolbar__plus, .ce-toolbar__settings-btn': { color: 'var(--tt-muted, #9a9aa6)' },
				// the grip doubles as the block-drag handle: keep the browser from
				// hijacking a touch long-press into page scroll, and hint the affordance
				'.ce-toolbar__settings-btn': { touchAction: 'none', cursor: 'grab' },
				'@media screen and (max-width: 650px)': {
					// Editor.js fixes its mobile sheets to the layout viewport. Keep the
					// opened top-level sheet inside iOS's keyboard/zoom visual viewport.
					'.ce-popover.ce-popover--opened:not(.ce-popover--inline):not(.ce-popover--nested) > .ce-popover__container': {
						left: 'calc(var(--tt-editor-visual-viewport-left, 0px) + var(--tt-editor-popover-edge-gap) + var(--thingtime-safe-area-left, 0px))',
						right: 'auto',
						bottom:
							'calc(var(--tt-editor-visual-viewport-bottom-inset, 0px) + var(--tt-editor-popover-edge-gap) + var(--thingtime-safe-area-bottom, 0px))',
						width:
							'max(0px, calc(var(--tt-editor-visual-viewport-width, 100vw) - var(--tt-editor-popover-edge-gap) - var(--tt-editor-popover-edge-gap) - var(--thingtime-safe-area-left, 0px) - var(--thingtime-safe-area-right, 0px)))',
						minWidth: 0,
						maxWidth:
							'max(0px, calc(var(--tt-editor-visual-viewport-width, 100vw) - var(--tt-editor-popover-edge-gap) - var(--tt-editor-popover-edge-gap) - var(--thingtime-safe-area-left, 0px) - var(--thingtime-safe-area-right, 0px)))',
						maxHeight:
							'max(0px, min(var(--max-height, 270px), calc(var(--tt-editor-visual-viewport-height, 100vh) - var(--tt-editor-popover-edge-gap) - var(--tt-editor-popover-edge-gap) - var(--thingtime-safe-area-top, 0px) - var(--thingtime-safe-area-bottom, 0px))))'
					}
				},
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
});
LongTextEditorInner.displayName = 'LongTextEditorInner';

// Outer wrapper: changing `blockTypes` needs an editor re-init (editor.js
// cannot swap tools live), so we remount the inner editor keyed by the
// enabled-tool set while carrying the latest edited value across the remount.
const EditableLongTextEditor = React.forwardRef<LongTextEditorHandle, LongTextEditorProps>((props, ref) => {
	const [localHistory] = React.useState(() => new EditorHistory());
	const history = props.history ?? localHistory;
	const [carryPreferences, setCarryPreferences] = React.useState<StyleCarryPreferences>({});
	const latestDocRef = React.useRef<EditorJsDoc | undefined>(undefined);
	const hostRef = React.useRef<HTMLDivElement>(null);
	const navigating = React.useRef(false);
	const lopu = useLopu();
	const latestRef = React.useRef<LongTextValue | null>(null);
	const innerRef = React.useRef<(LongTextEditorHandle & EditorHistoryHandle) | null>(null);
	const valueMode = isEditorJsDoc(props.value) ? 'blocks' : 'string';
	const valueModeRef = React.useRef(valueMode);
	const incomingSignature = getEditorJsValueSignature(props.value);
	const incomingSignatureRef = React.useRef(incomingSignature);
	const latestSignatureRef = React.useRef(incomingSignature);
	const pendingEmittedSignaturesRef = React.useRef<string[]>([]);
	const externalRevisionRef = React.useRef(0);
	const editorRefreshRevisionRef = React.useRef(0);
	const activeConfigKeyRef = React.useRef('');
	const changeSequenceRef = React.useRef(0);
	const lastAcceptedSequenceRef = React.useRef(0);
	const allocateChangeSequence = React.useCallback(() => {
		changeSequenceRef.current += 1;
		return changeSequenceRef.current;
	}, []);
	React.useImperativeHandle(ref, () => ({ save: () => innerRef.current?.save() ?? Promise.resolve(latestRef.current ?? props.value) }), [
		props.value
	]);

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
	const pending = pendingEmittedSignaturesRef.current;
	if (acknowledgeLatestEditorJsEcho(pending, incomingSignatureRef.current, incomingSignature, latestSignatureRef.current)) {
		// React may batch A -> AB -> A into one final A prop render. Acknowledge
		// that latest echo even when its signature equals the previously rendered
		// prop, otherwise the skipped AB marker could swallow a later real undo.
		pending.length = 0;
		latestRef.current = props.value;
	}

	if (incomingSignatureRef.current !== incomingSignature) {
		incomingSignatureRef.current = incomingSignature;
		const echoIndex = pending.indexOf(incomingSignature);
		const pendingEcho = echoIndex >= 0;

		if (!pendingEcho) {
			pending.length = 0;
			latestRef.current = props.value;
			latestSignatureRef.current = incomingSignature;
			externalRevisionRef.current += 1;
			latestDocRef.current = undefined;
		} else {
			// Acknowledging an emitted value also retires every older edit. Keep
			// newer unacknowledged values live so a delayed parent echo cannot
			// roll the editor back.
			pending.splice(0, echoIndex + 1);
			if (latestSignatureRef.current === incomingSignature) latestRef.current = props.value;
		}
	}

	const sourceRevision = {
		valueMode,
		externalRevision: externalRevisionRef.current
	};
	const configKey = `${valueMode}:${externalRevisionRef.current}:${editorRefreshRevisionRef.current}:${LONG_TEXT_BLOCK_TYPES.filter(
		(tool) => props.blockTypes?.[tool] !== false
	).join(',')}`;
	activeConfigKeyRef.current = configKey;
	const onValueChange = props.onValueChange;

	const handleChange = React.useCallback(
		(next: LongTextValue, source: EditorJsSourceRevision, sequence: number, doc: EditorJsDoc, label?: string) => {
			// An explicit conversion/replacement wins over a late save from the old
			// editor. A tool-config-only remount keeps the edit and refreshes the new
			// editor once the parent echoes the drained value.
			if (
				!shouldAcceptEditorJsSnapshot(
					source,
					{ valueMode: valueModeRef.current, externalRevision: externalRevisionRef.current },
					sequence,
					lastAcceptedSequenceRef.current
				)
			)
				return;
			// Save requests from every keyed Editor.js instance share this sequence.
			// A late old-config result cannot overwrite a newer edit from the current
			// instance even if its promise resolves last.
			if (sequence <= lastAcceptedSequenceRef.current) return;
			lastAcceptedSequenceRef.current = sequence;
			latestDocRef.current = doc;
			history.record(doc, label);
			hostRef.current?.dispatchEvent(
				new CustomEvent('tt-editor-update', { bubbles: true, detail: { event: history.current, cursor: history.cursor } })
			);
			if (source.configKey !== activeConfigKeyRef.current) editorRefreshRevisionRef.current += 1;

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
		[onValueChange, history]
	);
	const act = React.useCallback(
		async (action: HistoryAction) => {
			if (navigating.current || props.readonly) return;
			navigating.current = true;
			let previous = history.cursor;
			try {
				await innerRef.current?.flush();
				previous = history.cursor;
				if (action.type === 'patch') {
					const result = history.patch(action.id, action.direction);
					if (result.conflicts) {
						lopu({
							title: 'This change overlaps later edits',
							description: 'Restore its timeline point to review the complete earlier version. Your current work and all branches are kept.',
							status: 'info'
						});
						return;
					}
					history.record(result.doc, `${action.direction === 'revert' ? 'Revert' : 'Reapply'} change ${action.id}`);
				} else {
					const id = action.type === 'select' ? action.id : action.type === 'undo' ? history.undoId : history.redoId;
					if (id === null) return;
					history.select(id);
				}
				await innerRef.current?.restore(history.current.doc);
			} catch {
				history.select(previous);
				lopu({ title: 'Could not restore this change', description: 'Your history is still available. Please try again.', status: 'error' });
			} finally {
				navigating.current = false;
			}
		},
		[history, lopu, props.readonly]
	);
	React.useEffect(() => {
		const host = hostRef.current;
		const onCommand = (event: Event) => {
			event.stopPropagation();
			void act((event as CustomEvent).detail);
		};
		const onError = () =>
			lopu({
				title: 'An editor change could not be recorded',
				description: 'Your text remains in the editor. Please retry saving before closing it.',
				status: 'error'
			});
		host?.addEventListener('tt-editor-history-command', onCommand);
		host?.addEventListener('tt-editor-history-error', onError);
		return () => {
			host?.removeEventListener('tt-editor-history-command', onCommand);
			host?.removeEventListener('tt-editor-history-error', onError);
		};
	}, [act, lopu]);

	// Keep this wrapper mounted for unsafe external replacements so it can bump
	// the generation above and invalidate any save draining from the old editor.
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

	return (
		<Box
			ref={hostRef}
			className="tt-editor-session"
			position="relative"
			zIndex={8}
			onKeyDownCapture={(event) => {
				if (
					(event.metaKey || event.ctrlKey) &&
					event.key.toLowerCase() === 'z' &&
					!event.altKey &&
					!event.nativeEvent.isComposing &&
					!props.readonly
				) {
					event.preventDefault();
					event.stopPropagation();
					void act({ type: event.shiftKey ? 'redo' : 'undo' });
				}
			}}
			sx={{
				'.tt-editor-history-controls': {
					position: 'absolute',
					left: '4px',
					top: 'var(--tt-editor-chrome-top,-29px)',
					zIndex: 8,
					width: 'max-content',
					maxWidth: 'calc(100vw - 16px)',
					flexWrap: 'wrap',
					background: 'var(--tt-card, #fff)',
					borderRadius: '8px',
					pointerEvents: 'auto'
				}
			}}
		>
			{/* Editor.js leaves hidden tooltips at their last desktop coordinates. */}
			<Global styles={{ '.ct:not(.ct--shown)': { display: 'none' } }} />
			{!props.readonly ? (
				<EditorHistoryControls history={history} act={act} preferences={carryPreferences} onPreferences={setCarryPreferences} />
			) : null}
			<LongTextEditorInner
				{...props}
				ref={innerRef}
				key={configKey}
				value={latestRef.current ?? props.value}
				seedDoc={latestDocRef.current}
				history={history}
				carryPreferences={carryPreferences}
				allocateChangeSequence={allocateChangeSequence}
				onValueChange={(next, sequence, doc, label) => handleChange(next, { ...sourceRevision, configKey }, sequence, doc, label)}
			/>
		</Box>
	);
});
EditableLongTextEditor.displayName = 'EditableLongTextEditor';

export const LongTextEditor = React.forwardRef<LongTextEditorHandle, LongTextEditorProps>((props, ref) => {
	return <EditableLongTextEditor {...props} ref={ref} />;
});
LongTextEditor.displayName = 'LongTextEditor';
