import React from 'react';
import { Box, Flex, Portal, Text } from '@chakra-ui/react';

import { ProfileAvatarCircle } from '~/components/Profile/ProfilePage';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { ACTIVE_MENTION_QUERY_PATTERN, isMentionableUsername } from '~/utils/mentions';

// @mention autocomplete for the composer's Editor.js body (posts AND comments
// — both run through PostComposer's LongTextEditor). Typing `@` + ≥1 char
// shows a small dropdown of people (debounced users/search), keyboard
// up/down/enter/tab + click select, Escape closes; selecting replaces the
// typed `@partial` with `@username ` at the caret.
//
// Insertion mechanism: Editor.js exposes no caret-level text-insert API for
// string-mode paragraphs, so selection is edited through the native DOM —
// replaceData on the caret's own Text node, caret restored immediately after
// the inserted text (it never leaves the node, so there is no jump), then an
// `input` event is dispatched so LongTextEditor's raw-input fallback (an
// explicit listener for programmatic/IME mutations Editor.js misses)
// snapshots the DOM and serialises it back to the composer's text state.
// Detection is equally read-only: the text before the caret in the focused
// Text node is matched against the shared in-progress grammar
// (ACTIVE_MENTION_QUERY_PATTERN — same module the server parses with), so the
// dropdown can only ever offer what would actually tokenize on publish.

const BORDER = '1px solid var(--tt-border, #ececef)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const INK = 'var(--tt-ink, #16161a)';

const SEARCH_DEBOUNCE_MS = 200;
const MAX_RESULTS = 6;
const DROPDOWN_WIDTH = 260;

type MentionCandidate = {
	id: string;
	username: string;
	displayName: string | null;
	avatarUrl: string | null;
};

type ActiveMention = {
	// the caret's Text node holding the in-progress `@query`
	node: globalThis.Text;
	// index of the `@` inside the node
	start: number;
	// the typed name so far (no `@`)
	query: string;
	// caret offset at detection time (end of the typed name)
	caret: number;
};

// The collapsed caret's in-progress mention, or null. Node-local by design: a
// caret at the start of a Text node that follows inline formatting can in
// principle miss its true word-start context, but a false dropdown there is
// harmless — the server re-parses the SERIALISED text, so nothing mis-fires.
const readActiveMention = (host: HTMLElement | null): ActiveMention | null => {
	if (!host) return null;
	const selection = window.getSelection();
	if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	const node = range.startContainer;
	if (node.nodeType !== Node.TEXT_NODE || !host.contains(node)) return null;
	const caret = range.startOffset;
	const before = (node as globalThis.Text).data.slice(0, caret);
	const match = before.match(ACTIVE_MENTION_QUERY_PATTERN);
	if (!match) return null;
	return { node: node as globalThis.Text, start: before.length - match[2].length - 1, query: match[2], caret };
};

// viewport-fixed anchor just under the `@…` being typed
const mentionAnchorRect = (active: ActiveMention): { left: number; top: number } | null => {
	try {
		const range = document.createRange();
		range.setStart(active.node, active.start);
		range.setEnd(active.node, Math.min(active.caret, active.node.length));
		const rect = range.getBoundingClientRect();
		return {
			left: Math.max(8, Math.min(rect.left, window.innerWidth - DROPDOWN_WIDTH - 8)),
			top: rect.bottom + 4
		};
	} catch {
		return null;
	}
};

export const MentionAutocomplete = ({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) => {
	const api = useApi();
	const user = useCurrentUser();
	const [active, setActive] = React.useState<ActiveMention | null>(null);
	const [anchor, setAnchor] = React.useState<{ left: number; top: number } | null>(null);
	const [results, setResults] = React.useState<MentionCandidate[]>([]);
	const [highlight, setHighlight] = React.useState(0);

	const activeRef = React.useRef(active);
	activeRef.current = active;
	const resultsRef = React.useRef(results);
	resultsRef.current = results;
	const highlightRef = React.useRef(highlight);
	highlightRef.current = highlight;
	const searchRef = React.useRef(api.v1.profile.search);
	searchRef.current = api.v1.profile.search;
	const selfIdRef = React.useRef(user?.id || null);
	selfIdRef.current = user?.id || null;

	const close = React.useCallback(() => {
		setActive(null);
		setResults([]);
		setHighlight(0);
	}, []);

	const detect = React.useCallback(() => {
		const next = readActiveMention(containerRef.current);
		if (!next) {
			if (activeRef.current) close();
			return;
		}
		setActive(next);
		setAnchor(mentionAnchorRect(next));
	}, [containerRef, close]);

	// Replace the typed `@partial` with `@username ` in the caret's own Text
	// node and put the caret right after — see the header comment for why this
	// is native DOM surgery rather than an Editor.js API call.
	const insert = React.useCallback(
		(candidate: MentionCandidate) => {
			const context = activeRef.current;
			if (!context || !isMentionableUsername(candidate.username)) return;
			const { node, start } = context;
			if (!node.isConnected) return close();
			const end = Math.min(context.caret, node.length);
			const inserted = `@${candidate.username} `;
			node.replaceData(start, Math.max(0, end - start), inserted);
			const selection = window.getSelection();
			if (selection) {
				const range = document.createRange();
				range.setStart(node, Math.min(start + inserted.length, node.length));
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);
			}
			// hand the mutation to LongTextEditor's raw-input fallback listener
			(node.parentElement || containerRef.current)?.dispatchEvent(new InputEvent('input', { bubbles: true }));
			close();
		},
		[containerRef, close]
	);
	const insertRef = React.useRef(insert);
	insertRef.current = insert;

	// detection + keyboard live on the composer container. Keydown binds in the
	// CAPTURE phase so an open dropdown owns arrows/enter/escape before
	// Editor.js can act on them (Enter would otherwise split the block).
	React.useEffect(() => {
		const host = containerRef.current;
		if (!host) return;
		const onInput = () => detect();
		const onKeyUp = (event: KeyboardEvent) => {
			// Escape's keyup right after the capture-phase close must not reopen
			if (event.key === 'Escape') return;
			detect();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (!activeRef.current || !resultsRef.current.length) return;
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				const delta = event.key === 'ArrowDown' ? 1 : -1;
				const count = resultsRef.current.length;
				setHighlight((current) => (current + delta + count) % count);
			} else if (event.key === 'Enter' || event.key === 'Tab') {
				const pick = resultsRef.current[highlightRef.current];
				if (pick) insertRef.current(pick);
			} else if (event.key === 'Escape') {
				close();
			} else {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
		};
		host.addEventListener('input', onInput);
		host.addEventListener('keyup', onKeyUp);
		host.addEventListener('keydown', onKeyDown, true);
		return () => {
			host.removeEventListener('input', onInput);
			host.removeEventListener('keyup', onKeyUp);
			host.removeEventListener('keydown', onKeyDown, true);
		};
		// containerRef.current is stable for the composer's lifetime (the Box
		// around LongTextEditor); detect/close are stable callbacks
	}, [containerRef, detect, close]);

	// clicking anywhere outside dismisses; scrolling re-anchors under the caret
	React.useEffect(() => {
		if (!active) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (target && (containerRef.current?.contains(target) || document.getElementById('tt-mention-dropdown')?.contains(target))) return;
			close();
		};
		const onScroll = () => {
			const context = activeRef.current;
			if (context) setAnchor(mentionAnchorRect(context));
		};
		document.addEventListener('pointerdown', onPointerDown);
		window.addEventListener('scroll', onScroll, true);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('scroll', onScroll, true);
		};
	}, [active, containerRef, close]);

	// debounced people search for the typed query
	const query = active?.query || '';
	React.useEffect(() => {
		if (!query) {
			setResults([]);
			return;
		}
		let cancelled = false;
		const timer = window.setTimeout(() => {
			searchRef
				.current({ q: query, limit: MAX_RESULTS })
				.then((resp: any) => {
					if (cancelled) return;
					const users: MentionCandidate[] = (Array.isArray(resp?.users) ? resp.users : [])
						.filter(
							(entry: any) =>
								entry && typeof entry.username === 'string' && isMentionableUsername(entry.username) && entry.id !== selfIdRef.current
						)
						.slice(0, MAX_RESULTS)
						.map((entry: any) => ({
							id: String(entry.id),
							username: entry.username,
							displayName: typeof entry.displayName === 'string' ? entry.displayName : null,
							avatarUrl: typeof entry.avatarUrl === 'string' ? entry.avatarUrl : null
						}));
					setResults(users);
					setHighlight(0);
				})
				.catch(() => {
					if (!cancelled) setResults([]);
				});
		}, SEARCH_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [query]);

	if (!active || !anchor || !results.length) return null;

	return (
		<Portal>
			<Box
				id="tt-mention-dropdown"
				position="fixed"
				left={`${anchor.left}px`}
				top={`${anchor.top}px`}
				width={`${DROPDOWN_WIDTH}px`}
				zIndex={1700}
				background="var(--tt-card, #ffffff)"
				border={BORDER}
				borderRadius="var(--tt-radius-md, 12px)"
				boxShadow="0 12px 40px rgba(22, 22, 26, 0.14)"
				paddingY={1}
				overflow="hidden"
				role="listbox"
				aria-label="Mention someone"
			>
				{results.map((candidate, index) => (
					<Flex
						key={candidate.id}
						as="button"
						type="button"
						role="option"
						aria-selected={index === highlight}
						width="100%"
						textAlign="left"
						alignItems="center"
						columnGap={2}
						paddingX={2.5}
						paddingY={1.5}
						background={index === highlight ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
						_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
						// preventDefault keeps focus (and the caret) in the editor so
						// the stored insertion context stays valid for the click
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => insert(candidate)}
						onMouseEnter={() => setHighlight(index)}
					>
						<ProfileAvatarCircle avatarUrl={candidate.avatarUrl} name={candidate.displayName || candidate.username} size="24px" fontSize="10px" />
						<Box minWidth={0}>
							<Text fontSize="sm" color={INK} noOfLines={1}>
								@{candidate.username}
							</Text>
							{candidate.displayName && (
								<Text fontSize="xs" color={MUTED} noOfLines={1}>
									{candidate.displayName}
								</Text>
							)}
						</Box>
					</Flex>
				))}
			</Box>
		</Portal>
	);
};
