import React from 'react';
import { Box } from '@chakra-ui/react';

// LongTextEditor — Editor.js block editing for long-text values, everywhere.
//
// Two modes, decided by the value's shape (single source of truth: the data):
//  - string mode: a long plain string is converted to blocks for editing and
//    serialised back to a markdown-ish plain string on every change, so the
//    stored thing stays a friendly string (paragraphs, "## " headings, "- "
//    lists, "- [ ]" checklists, "> " quotes, "---" dividers round-trip).
//  - block mode: a value that already is an Editor.js doc ({ blocks: [...] })
//    is edited natively and emitted back as { ...value, blocks } — this is the
//    'rich-text' kind, renderable read-only by the kind registry.
//
// Editor.js is browser-only, so the library and its tools load via dynamic
// import inside an effect; SSR and non-DOM environments never touch it.

export type EditorJsDoc = { blocks: Array<{ type: string; data: Record<string, unknown> }> } & Record<string, unknown>;

export type LongTextValue = string | EditorJsDoc;

// the "is this string long enough to deserve a block editor" heuristic used
// across the board (tree, concepts, composer)
export const isLongText = (value: unknown): value is string =>
	typeof value === 'string' && (value.length > 160 || value.includes('\n'));

export const isEditorJsDoc = (value: unknown): value is EditorJsDoc =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as EditorJsDoc).blocks);

// ————— inline html ↔ text (editor.js allows <b>/<i>/<a> inside blocks) —————

const stripInlineHtml = (html: unknown): string =>
	String(html ?? '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&nbsp;/g, ' ');

const escapeInline = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ————— plain text → blocks —————

export const textToBlocks = (text: string): EditorJsDoc['blocks'] => {
	const blocks: EditorJsDoc['blocks'] = [];
	// paragraphs split on blank lines; single newlines survive inside list runs
	const chunks = text.split(/\n{2,}/);

	for (const chunk of chunks) {
		const lines = chunk.split('\n').filter((line) => line.trim() !== '');
		if (!lines.length) continue;

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

		for (const line of lines) {
			const header = line.match(/^(#{1,6})\s+(.*)$/);
			const check = line.match(/^-\s\[( |x|X)\]\s+(.*)$/);
			const bullet = line.match(/^[-*]\s+(.*)$/);
			const ordered = line.match(/^\d+[.)]\s+(.*)$/);
			const quote = line.match(/^>\s?(.*)$/);

			if (header) {
				flushParagraph();
				flushList();
				flushChecklist();
				blocks.push({ type: 'header', data: { text: escapeInline(header[2]), level: Math.min(header[1].length, 4) } });
			} else if (line.trim() === '---') {
				flushParagraph();
				flushList();
				flushChecklist();
				blocks.push({ type: 'delimiter', data: {} });
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
				flushParagraph();
				flushList();
				flushChecklist();
				blocks.push({ type: 'quote', data: { text: escapeInline(quote[1]), caption: '' } });
			} else {
				flushList();
				flushChecklist();
				buffer.push(line);
			}
		}

		flushParagraph();
		flushList();
		flushChecklist();
	}

	return blocks.length ? blocks : [{ type: 'paragraph', data: { text: escapeInline(text) } }];
};

// ————— blocks → plain text (the inverse) —————

const checklistItems = (data: Record<string, unknown>): Array<{ text: string; checked: boolean }> =>
	(Array.isArray(data.items) ? data.items : []).map((item) => {
		const record = (item || {}) as Record<string, unknown>;
		return { text: stripInlineHtml(record.text ?? record.content ?? item), checked: record.checked === true };
	});

export const blocksToText = (blocks: EditorJsDoc['blocks']): string =>
	blocks
		.map((block) => {
			const data = block.data || {};
			if (block.type === 'header') {
				const level = Math.max(1, Math.min(6, Number(data.level) || 2));
				return `${'#'.repeat(level)} ${stripInlineHtml(data.text)}`;
			}
			if (block.type === 'list') {
				const ordered = data.style === 'ordered';
				const items = Array.isArray(data.items) ? data.items : [];
				return items
					.map((item, idx) => {
						const record = (item || {}) as Record<string, unknown>;
						const text = stripInlineHtml(typeof item === 'string' ? item : record.text ?? record.content);
						return ordered ? `${idx + 1}. ${text}` : `- ${text}`;
					})
					.join('\n');
			}
			if (block.type === 'checklist') {
				return checklistItems(data)
					.map((item) => `- [${item.checked ? 'x' : ' '}] ${item.text}`)
					.join('\n');
			}
			if (block.type === 'quote') {
				const caption = stripInlineHtml(data.caption);
				return `> ${stripInlineHtml(data.text)}${caption ? `\n> — ${caption}` : ''}`;
			}
			if (block.type === 'delimiter') {
				return '---';
			}
			return stripInlineHtml(data.text);
		})
		.filter((chunk) => chunk.trim() !== '')
		.join('\n\n');

// ————— the component —————

export type LongTextEditorProps = {
	value: LongTextValue;
	onValueChange?: (next: LongTextValue) => void;
	placeholder?: string;
	minHeight?: string;
};

export const LongTextEditor = (props: LongTextEditorProps) => {
	const holderRef = React.useRef<HTMLDivElement | null>(null);
	const editorRef = React.useRef<any>(null);
	const destroyedRef = React.useRef(false);
	// the mode is fixed at mount by the incoming value's shape
	const blockModeRef = React.useRef(isEditorJsDoc(props.value));
	const valueRef = React.useRef(props.value);
	const onChangeRef = React.useRef(props.onValueChange);
	// remember the last text we emitted so prop echoes don't reset the editor
	const lastEmittedRef = React.useRef<string | null>(null);
	const rawInputCleanupRef = React.useRef<(() => void) | null>(null);

	React.useEffect(() => {
		valueRef.current = props.value;
		onChangeRef.current = props.onValueChange;
	});

	React.useEffect(() => {
		destroyedRef.current = false;
		let cancelled = false;

		(async () => {
			if (!holderRef.current) return;

			const [{ default: EditorJS }, { default: Header }, { default: List }, { default: Quote }, { default: Checklist }, { default: Delimiter }] = await Promise.all([
				import('@editorjs/editorjs'),
				import('@editorjs/header'),
				import('@editorjs/list'),
				import('@editorjs/quote'),
				import('@editorjs/checklist'),
				import('@editorjs/delimiter')
			]);

			if (cancelled || !holderRef.current) return;

			const initial = valueRef.current;
			const blocks = isEditorJsDoc(initial) ? initial.blocks : textToBlocks(String(initial ?? ''));

			const editor = new EditorJS({
				holder: holderRef.current,
				data: { blocks },
				placeholder: props.placeholder || 'Imagine..',
				minHeight: 0,
				tools: {
					header: { class: Header as any, inlineToolbar: true, config: { levels: [1, 2, 3, 4], defaultLevel: 2 } },
					list: { class: List as any, inlineToolbar: true },
					quote: { class: Quote as any, inlineToolbar: true },
					checklist: { class: Checklist as any, inlineToolbar: true },
					delimiter: Delimiter as any
				},
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
				'.codex-editor__redactor': { paddingBottom: '0 !important' },
				'.ce-block__content, .ce-toolbar__content': { maxWidth: '100%' },
				'.ce-toolbar__plus, .ce-toolbar__settings-btn': { color: 'var(--tt-muted, #9a9aa6)' },
				'.ce-paragraph[data-placeholder]:empty::before': { color: 'var(--tt-faint, #b6b6c0)' }
			}}
		/>
	);
};
