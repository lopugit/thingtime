import React from 'react';
import { Box } from '@chakra-ui/react';

import { LongTextEditor, type LongTextValue } from '../Editor/LongTextEditor';
import { isEditorJsDoc } from '../Editor/editorJsValue';
import { editorJsToHtml, htmlToEditorJs, htmlToPlainText } from './editorJsHtml';

// The FULL Editor.js editor, inline on the canvas: a selected text block
// edits in place with the real block vocabulary (headings, lists, quotes,
// tables, inline formatting) — what the modal offered, without leaving the
// page. Changes convert doc → sanitised-at-render html on every edit; the
// lastEmitted ref separates our own echoes from EXTERNAL html changes
// (advanced modal Apply, discard), which re-seed the editor.
export const InlineRichTextEditor = ({
	html,
	text,
	onChange
}: {
	html?: string;
	text?: string;
	onChange: (patch: { html: string; text: string }) => void;
}) => {
	const seed = React.useCallback(
		(seedHtml: string | undefined, seedText: string | undefined): LongTextValue =>
			htmlToEditorJs(seedHtml || (seedText ? `<p>${seedText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>` : '<p></p>')),
		[]
	);
	const [value, setValue] = React.useState<LongTextValue>(() => seed(html, text));
	const lastEmittedRef = React.useRef<string>(html || '');

	React.useEffect(() => {
		if ((html || '') !== lastEmittedRef.current) {
			// external content change — re-seed (LongTextEditor remounts itself on
			// genuinely different incoming values)
			lastEmittedRef.current = html || '';
			setValue(seed(html, text));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- text only matters alongside an html change
	}, [html, seed]);

	const handleChange = React.useCallback(
		(next: LongTextValue) => {
			setValue(next);
			if (!isEditorJsDoc(next)) {
				lastEmittedRef.current = '';
				onChange({ html: '', text: String(next || '') });
				return;
			}
			const nextHtml = editorJsToHtml(next);
			lastEmittedRef.current = nextHtml;
			onChange({ html: nextHtml, text: htmlToPlainText(nextHtml).slice(0, 2000) });
		},
		[onChange]
	);

	return (
		<Box
			className="ttInlineRichTextEditor"
			data-testid="inline-rich-text-editor"
			sx={{
				// the editor owns its typography; keep the canvas frame calm
				'& .codex-editor__redactor': { paddingBottom: '8px !important' },
				whiteSpace: 'normal'
			}}
			onClick={(event: React.MouseEvent) => event.stopPropagation()}
		>
			<LongTextEditor
				value={value}
				onValueChange={handleChange}
				placeholder="Write something lovely ✨"
				minHeight="1.6em"
				blockTypes={{ style: false, embed: false, warning: false }}
			/>
		</Box>
	);
};
