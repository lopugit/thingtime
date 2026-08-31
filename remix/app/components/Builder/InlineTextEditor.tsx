import React from 'react';
import { Box, Flex } from '@chakra-ui/react';

// In-canvas WYSIWYG editing for text blocks: the selected block's text turns
// contentEditable in place (what you type is exactly what renders), with a
// floating formatting toolbar on text selection. Enter and Shift+Enter both
// insert soft line breaks, paste keeps rich formatting, and everything is
// stored as html + plain-text fallback — rendered later ONLY through the
// sanitising allowlist renderer, so no formatting shortcut widens trust.

const escapeHtml = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

type ToolbarState = { x: number; y: number } | null;

const TOOLBAR_ACTIONS: Array<{ key: string; label: string; title: string; run: () => void }> = [
	{ key: 'bold', label: 'B', title: 'Bold', run: () => document.execCommand('bold') },
	{ key: 'italic', label: 'I', title: 'Italic', run: () => document.execCommand('italic') },
	{ key: 'underline', label: 'U', title: 'Underline', run: () => document.execCommand('underline') },
	{ key: 'strike', label: 'S', title: 'Strikethrough', run: () => document.execCommand('strikeThrough') },
	{
		key: 'link',
		label: '🔗',
		title: 'Link selection',
		run: () => {
			// eslint-disable-next-line no-alert -- deliberate minimal link prompt
			const url = window.prompt('Link URL (https://…)');
			if (url && /^https?:\/\//.test(url)) document.execCommand('createLink', false, url);
		}
	},
	{ key: 'clear', label: '✕', title: 'Clear formatting', run: () => document.execCommand('removeFormat') }
];

export const InlineTextEditor = ({
	html,
	text,
	onChange,
	onDone,
	typography
}: {
	html?: string;
	text?: string;
	onChange: (patch: { html: string; text: string }) => void;
	onDone?: () => void;
	// the block's resolved typography props so editing looks exactly like the
	// rendered block (WYSIWYG means zero visual jump on click)
	typography?: Record<string, unknown>;
}) => {
	const ref = React.useRef<HTMLDivElement | null>(null);
	const [toolbar, setToolbar] = React.useState<ToolbarState>(null);
	const commitTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	const commit = React.useCallback(() => {
		const el = ref.current;
		if (!el) return;
		onChange({ html: el.innerHTML, text: el.textContent || '' });
	}, [onChange]);

	// mount once with the current content and take the caret — NEVER rewrite
	// innerHTML afterwards (state round-trips would eat the caret position)
	React.useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.innerHTML = html || escapeHtml(text || '');
		try {
			// formatting commands produce span styles instead of legacy font tags
			document.execCommand('styleWithCSS', false, 'true');
		} catch {
			// older engines: tag-based output still renders through the allowlist
		}
		el.focus();
		try {
			const selection = window.getSelection();
			const range = document.createRange();
			range.selectNodeContents(el);
			range.collapse(false);
			selection?.removeAllRanges();
			selection?.addRange(range);
		} catch {
			// caret placement is best-effort
		}
		return () => {
			if (commitTimer.current) clearTimeout(commitTimer.current);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
	}, []);

	const updateToolbar = React.useCallback(() => {
		const el = ref.current;
		const selection = window.getSelection();
		if (!el || !selection || selection.isCollapsed || !selection.anchorNode || !el.contains(selection.anchorNode)) {
			setToolbar(null);
			return;
		}
		try {
			const rect = selection.getRangeAt(0).getBoundingClientRect();
			setToolbar({ x: rect.left + rect.width / 2, y: rect.top });
		} catch {
			setToolbar(null);
		}
	}, []);

	return (
		<>
			<Box
				ref={ref}
				className="ttInlineTextEditor"
				data-testid="inline-text-editor"
				contentEditable
				suppressContentEditableWarning
				// the selected BlockFrame already draws the selection outline — a
				// second outline here reads as a double border once the block has
				// its own padding
				outline="none"
				minWidth="40px"
				minHeight="1em"
				cursor="text"
				sx={{ whiteSpace: 'pre-wrap', WebkitUserSelect: 'text', userSelect: 'text' }}
				{...(typography || {})}
				onInput={() => {
					if (commitTimer.current) clearTimeout(commitTimer.current);
					commitTimer.current = setTimeout(commit, 250);
				}}
				onBlur={() => {
					if (commitTimer.current) clearTimeout(commitTimer.current);
					commit();
					setToolbar(null);
				}}
				onKeyDown={(event: React.KeyboardEvent) => {
					if (event.key === 'Escape') {
						event.preventDefault();
						commit();
						onDone?.();
						return;
					}
					// Enter AND Shift+Enter insert soft line breaks — a text block is
					// one flowing passage, never a nest of browser-invented divs
					if (event.key === 'Enter') {
						event.preventDefault();
						document.execCommand('insertHTML', false, '<br>');
					}
				}}
				onKeyUp={updateToolbar}
				onMouseUp={updateToolbar}
				onClick={(event: React.MouseEvent) => {
					// clicks stay inside the editor (frames above must not re-handle)
					event.stopPropagation();
				}}
			/>
			{toolbar ? (
				<Flex
					className="ttWysiwygToolbar"
					position="fixed"
					left={`${Math.max(8, toolbar.x - 110)}px`}
					top={`${Math.max(8, toolbar.y - 46)}px`}
					zIndex={10200}
					columnGap="2px"
					padding="4px"
					borderRadius="var(--tt-radius-md, 12px)"
					border="1px solid"
					borderColor="var(--tt-border, #ececef)"
					background="var(--tt-card, #ffffff)"
					boxShadow="var(--tt-shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.12))"
					onMouseDown={(event: React.MouseEvent) => {
						// keep the text selection alive while pressing toolbar buttons
						event.preventDefault();
					}}
				>
					{TOOLBAR_ACTIONS.map((action) => (
						<Box
							key={action.key}
							as="button"
							type="button"
							title={action.title}
							aria-label={action.title}
							data-testid={`wysiwyg-${action.key}`}
							minWidth="30px"
							paddingX="7px"
							paddingY="5px"
							fontSize="13px"
							fontWeight={action.key === 'bold' ? 800 : 600}
							fontStyle={action.key === 'italic' ? 'italic' : undefined}
							textDecoration={action.key === 'underline' ? 'underline' : action.key === 'strike' ? 'line-through' : undefined}
							borderRadius="var(--tt-radius-sm, 9px)"
							color="var(--tt-ink, #16161a)"
							cursor="pointer"
							_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
							onClick={() => {
								action.run();
								commit();
								updateToolbar();
							}}
						>
							{action.label}
						</Box>
					))}
				</Flex>
			) : null}
		</>
	);
};
