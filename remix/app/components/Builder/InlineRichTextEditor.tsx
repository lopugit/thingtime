import React from 'react';
import { Box } from '@chakra-ui/react';

import { LongTextEditor, type LongTextValue } from '../Editor/LongTextEditor';
import { isEditorJsDoc } from '../Editor/editorJsValue';
import { editorJsToHtml, htmlToEditorJs, htmlToPlainText } from './editorJsHtml';
import type { EditorHistory } from '../Editor/editorHistory';

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

// The FULL Editor.js editor, inline on the canvas: a selected text block
// edits in place with the real block vocabulary (headings, lists, quotes,
// tables, inline formatting). Conversions are guarded three ways:
// - NO-OP SUPPRESSION: emissions equal to the current normalised content are
//   swallowed, so merely selecting a block (or the editor's own
//   normalisation / unmount drain) never rewrites html or dirties the draft;
// - ECHO/EXTERNAL split: a (html, text) prop change we did not emit re-seeds
//   the editor (drawer textarea edits, advanced-modal Apply, discard);
// - the image tool is DISABLED inline so pasted/dropped image FILES reach the
//   attachments uploader instead of dying as data-uris the render allowlist
//   rejects (the advanced modal keeps the tool for URL-based images).
export const InlineRichTextEditor = ({
	html,
	text,
	typography,
	history,
	onChange
}: {
	html?: string;
	text?: string;
	// the block's resolved typography so editing reads like the render
	typography?: Record<string, unknown>;
	history?: EditorHistory;
	onChange: (patch: { html: string; text: string }) => void;
}) => {
	const seedDoc = React.useCallback(
		(seedHtml: string | undefined, seedText: string | undefined): LongTextValue =>
			htmlToEditorJs(seedHtml || (seedText ? `<p>${escapeHtml(seedText)}</p>` : '<p></p>')),
		[]
	);
	const [value, setValue] = React.useState<LongTextValue>(() => seedDoc(html, text));
	// the NORMALISED form of what the editor currently holds — emissions equal
	// to it are no-ops, prop keys equal to it are our own echoes
	const lastEmittedRef = React.useRef<{ html: string; key: string }>({ html: '', key: '' });
	React.useState(() => {
		const initial = value;
		const normalised = isEditorJsDoc(initial) ? editorJsToHtml(initial) : String(initial || '');
		lastEmittedRef.current = { html: normalised, key: `${html || ''}::${text || ''}` };
		return null;
	});

	React.useEffect(() => {
		const key = `${html || ''}::${text || ''}`;
		if (key !== lastEmittedRef.current.key) {
			// external content change (drawer field, modal Apply, discard) —
			// re-seed; LongTextEditor remounts on genuinely different values
			const next = seedDoc(html, text);
			lastEmittedRef.current = {
				html: isEditorJsDoc(next) ? editorJsToHtml(next) : String(next || ''),
				key
			};
			setValue(next);
		}
	}, [html, text, seedDoc]);

	// click-to-type: focus the editor as soon as Editor.js has mounted its
	// contenteditable (retry briefly — the tools load async)
	const rootRef = React.useRef<HTMLDivElement | null>(null);
	React.useEffect(() => {
		let cancelled = false;
		let attempts = 0;
		const tryFocus = () => {
			if (cancelled) return;
			const editable = rootRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
			if (editable) {
				editable.focus();
				try {
					const selection = window.getSelection();
					const range = document.createRange();
					range.selectNodeContents(editable);
					range.collapse(false);
					selection?.removeAllRanges();
					selection?.addRange(range);
				} catch {
					// caret placement is best-effort
				}
				return;
			}
			if ((attempts += 1) < 20) setTimeout(tryFocus, 100);
		};
		tryFocus();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only focus
	}, []);

	const handleChange = React.useCallback(
		(next: LongTextValue) => {
			setValue(next);
			const nextHtml = isEditorJsDoc(next) ? editorJsToHtml(next) : `<p>${escapeHtml(String(next || ''))}</p>`;
			// normalisation echoes and unmount drains produce the same html —
			// swallowing them keeps untouched blocks byte-identical and clean
			if (nextHtml === lastEmittedRef.current.html) return;
			const nextText = htmlToPlainText(nextHtml).slice(0, 2000);
			lastEmittedRef.current = { html: nextHtml, key: `${nextHtml}::${nextText}` };
			onChange({ html: nextHtml, text: nextText });
		},
		[onChange]
	);

	return (
		<Box
			ref={rootRef}
			className="ttInlineRichTextEditor"
			data-testid="inline-rich-text-editor"
			{...(typography as any)}
			onClick={(event: React.MouseEvent) => event.stopPropagation()}
		>
			<LongTextEditor
				presentation="inline"
				history={history}
				value={value}
				onValueChange={handleChange}
				placeholder="Write something lovely ✨"
				minHeight="1.6em"
				blockTypes={{ embed: false, warning: false, image: false }}
			/>
		</Box>
	);
};
