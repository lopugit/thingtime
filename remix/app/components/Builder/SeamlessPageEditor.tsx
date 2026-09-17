import React from 'react';
import { Box, Button, Flex, Input, Select } from '@chakra-ui/react';
import { Link, useNavigate } from 'react-router';
import { createPortal, flushSync } from 'react-dom';

import { useLopu } from '../Lopu/useLopu';
import { defaultsFromArgs, sanitizeArgSpecs } from '../ComponentsLibrary/componentTemplate';
import { BuilderDrawer } from './BuilderDrawer';
import type { BuilderChrome } from './WebpageBlocksRenderer';
import { useBuilderChrome } from './useBuilderChrome';
import { findBlock, updateBlock, type WebpageBlock } from './webpageBlocks';
import type { UseWebpageDraft } from './useWebpage';
import { componentTextOverrides } from './componentTextOverrides';
import { VIEWPORT_PRESETS, boundViewportDimension, type BuilderViewportSize } from './BuilderViewport';
import { matchingTextArg, type SeamlessMode } from './seamlessMode';

const HELP = {
	edit: 'Click text or a button label to edit. Changes appear here immediately; Save publishes them.',
	view: 'Use the live page. Forms, links and actions work normally; the inspector stays available.',
	container: 'The classic framed canvas, with no page data runtime.',
	builder: 'Build with sample arguments and no page data runtime. Switch to View to use live data.',
	layout: 'Select blocks, drag their handles, or use + to insert. Page actions pause while arranging.'
};

// Loaded only when an owner opens the editor. All editing modes share the same
// renderer under /p/'s runtime, preserving form state and source subscriptions.
export default function SeamlessPageEditor({
	draft,
	mode,
	onMode,
	surface,
	surfaceDocument,
	onChrome,
	viewport,
	onViewport
}: {
	draft: UseWebpageDraft;
	viewport: BuilderViewportSize;
	onViewport: (size: BuilderViewportSize) => void;
	surface: React.RefObject<HTMLDivElement | null>;
	surfaceDocument: Document | null;
	onChrome: (chrome: BuilderChrome | null) => void;
	mode: SeamlessMode;
	onMode: (mode: SeamlessMode) => void;
}) {
	const builder = useBuilderChrome(draft, { enabled: mode === 'layout' || mode === 'builder' || mode === 'container' });
	const chromeRef = React.useRef(builder.chrome);
	chromeRef.current = builder.chrome;
	const chrome = React.useMemo<BuilderChrome>(
		() => ({
			seamlessMode: mode,
			hoverId: builder.chrome.hoverId,
			selectedId: builder.chrome.selectedId,
			onHover: (...args) => chromeRef.current.onHover(...args),
			onSelect: (...args) => chromeRef.current.onSelect(...args),
			onInsert: (...args) => chromeRef.current.onInsert(...args),
			onMove: (...args) => chromeRef.current.onMove(...args),
			onUpdate: (...args) => chromeRef.current.onUpdate?.(...args),
			onContextMenu: (...args) => chromeRef.current.onContextMenu?.(...args),
			onDropFiles: (...args) => chromeRef.current.onDropFiles?.(...args),
			onMediaToBlock: (...args) => chromeRef.current.onMediaToBlock?.(...args)
		}),
		[mode, builder.chrome.hoverId, builder.chrome.selectedId]
	);
	const [drawerOpen, setDrawerOpen] = React.useState(() => window.innerWidth >= 768);
	const [pageName, setPageName] = React.useState(draft.resolved?.page?.crystal?.name || 'Untitled page');
	const [acl, setAcl] = React.useState<string[]>(draft.resolved?.page?.acl || ['tt:user']);
	const [preset, setPreset] = React.useState('full');
	const [running, setRunning] = React.useState(false);
	React.useLayoutEffect(() => {
		onChrome(chrome);
	}, [chrome, onChrome]);
	React.useLayoutEffect(() => () => onChrome(null), [onChrome]);
	const current = React.useRef({ draft, chrome });
	current.current = { draft, chrome };
	const toolbar = React.useRef<HTMLDivElement>(null);
	React.useLayoutEffect(() => {
		const node = toolbar.current;
		if (!node) return;
		const root = document.documentElement;
		const previous = root.style.getPropertyValue('--tt-builder-toolbar-clearance');
		const observer = new ResizeObserver(() =>
			root.style.setProperty('--tt-builder-toolbar-clearance', `${Math.ceil(node.getBoundingClientRect().height) + 40}px`)
		);
		observer.observe(node);
		return () => {
			observer.disconnect();
			if (previous) root.style.setProperty('--tt-builder-toolbar-clearance', previous);
			else root.style.removeProperty('--tt-builder-toolbar-clearance');
		};
	}, []);
	const finishEdit = React.useRef<(() => void) | null>(null);
	const lopu = useLopu();
	const navigate = useNavigate();

	React.useEffect(() => {
		const page = surface.current;
		if (!page || mode !== 'edit') return;
		const onClick = (event: MouseEvent) => {
			const owner = page.ownerDocument;
			const view = owner.defaultView!;
			const target = event.target && (event.target as Node).nodeType === 1 ? (event.target as HTMLElement) : null;
			if (!target || !page.contains(target)) return;
			if (target.isContentEditable) return;
			finishEdit.current?.();
			const frame = target.closest<HTMLElement>('[data-block-id]');
			const id = frame?.dataset.blockId;
			if (!frame || !id) return;
			const { draft: latest, chrome: controls } = current.current;
			const block = findBlock(latest.blocks, id);
			if (!block) return;
			// Edit clicks cannot submit, navigate, or invoke an action.
			event.preventDefault();
			event.stopPropagation();
			controls.onSelect(id, frame);
			// Keep native controls and data-bound values intact. Editable text
			// must map unambiguously to authored text or a declared string arg.
			if (target.closest('input, textarea, select, video, audio') || target.children.length) return;
			const original = target.textContent || '';
			if (!original.trim()) return;
			let patch: ((value: string) => Partial<WebpageBlock>) | null = null;
			if (block.type === 'text' && !block.html && original === block.text) patch = (value) => ({ text: value });
			else if ((block.type === 'text' || block.type === 'html') && block.html) {
				const document = new DOMParser().parseFromString(block.html, 'text/html');
				const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
				const matches: Node[] = [];
				while (walker.nextNode()) if (walker.currentNode.textContent === original) matches.push(walker.currentNode);
				if (matches.length === 1)
					patch = (value) => {
						matches[0].textContent = value;
						return { html: document.body.innerHTML };
					};
			} else if (block.type === 'component') {
				const component = latest.componentsByRef[block.component || ''];
				const specs = sanitizeArgSpecs(component?.crystal?.args);
				const values = { ...defaultsFromArgs(specs), ...component?.crystal?.savedArgs, ...block.args };
				const labelKey = target.getAttribute('data-tt-label-key');
				const literal = componentTextOverrides(component?.crystal?.render, block.args).labels.find(
					(label) => label.key === labelKey && label.text === original
				);
				const arg = literal?.key || matchingTextArg(specs, values, original);
				if (arg) patch = (value) => ({ args: { ...findBlock(current.current.draft.blocks, id)?.args, [arg]: value } });
			}
			if (!patch) return;
			const originalNodes = Array.from(target.childNodes, (node) => ({ node, value: node.nodeValue }));
			const previousEditable = target.getAttribute('contenteditable');
			const previousLabel = target.getAttribute('aria-label');
			const previousOutline = target.style.outline;
			target.contentEditable = 'plaintext-only';
			target.setAttribute('aria-label', 'Edit text');
			target.style.outline = '1px dashed var(--tt-accent, hotpink)';
			let finished = false;
			const finish = (cancel = false) => {
				if (finished) return;
				finished = true;
				const value = target.textContent || '';
				// Restore React's last committed DOM before asking it to apply the
				// new draft. The browser owns only the active editing interval.
				for (const entry of originalNodes) entry.node.nodeValue = entry.value;
				target.replaceChildren(...originalNodes.map((entry) => entry.node));
				if (previousEditable === null) target.removeAttribute('contenteditable');
				else target.setAttribute('contenteditable', previousEditable);
				if (previousLabel === null) target.removeAttribute('aria-label');
				else target.setAttribute('aria-label', previousLabel);
				target.style.outline = previousOutline;
				target.removeEventListener('blur', blur);
				target.removeEventListener('keydown', keydown);
				target.removeEventListener('paste', paste);
				finishEdit.current = null;
				if (!cancel && value !== original) {
					const active = current.current.draft;
					active.setBlocks(updateBlock(active.blocks, id, patch!(value)));
				}
			};
			const blur = () => finish();
			const keydown = (key: KeyboardEvent) => {
				if (key.isComposing) return;
				if (key.key === ' ' && target.tagName === 'BUTTON') {
					key.preventDefault();
					key.stopPropagation();
					const selection = view.getSelection();
					if (selection?.rangeCount) {
						const range = selection.getRangeAt(0);
						range.deleteContents();
						const space = owner.createTextNode(' ');
						range.insertNode(space);
						range.setStartAfter(space);
						range.collapse(true);
						selection.removeAllRanges();
						selection.addRange(range);
					}
				}

				if (key.key === 'Escape') {
					key.preventDefault();
					key.stopPropagation();
					finish(true);
					target.blur();
				}
				if (key.key === 'Enter' && !key.shiftKey) {
					key.preventDefault();
					finish();
					target.blur();
				}
			};
			const paste = (pasteEvent: ClipboardEvent) => {
				pasteEvent.preventDefault();
				const selection = view.getSelection();
				if (!selection?.rangeCount) return;
				const range = selection.getRangeAt(0);
				if (!target.contains(range.commonAncestorContainer)) return;
				range.deleteContents();
				const text = owner.createTextNode(pasteEvent.clipboardData?.getData('text/plain') || '');
				range.insertNode(text);
				range.setStartAfter(text);
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);
			};
			finishEdit.current = () => finish();
			target.addEventListener('blur', blur);
			target.addEventListener('keydown', keydown);
			target.addEventListener('paste', paste);
			target.focus();
			const selection = view.getSelection();
			const range = owner.createRange();
			range.selectNodeContents(target);
			selection?.removeAllRanges();
			selection?.addRange(range);
		};
		page.addEventListener('click', onClick, true);
		return () => {
			finishEdit.current?.();
			page.removeEventListener('click', onClick, true);
		};
	}, [mode, surface, surfaceDocument]);

	const changeMode = (next: SeamlessMode) => {
		finishEdit.current?.();
		onMode(next);
	};
	const run = async (standalone = false) => {
		if (running) return;
		flushSync(() => finishEdit.current?.());
		setRunning(true);
		const result = await current.current.draft.save({ name: pageName, acl });
		if (!result.ok) {
			setRunning(false);
			lopu({ title: result.error || 'Save failed. Your draft is still here.', status: 'error' });
			return;
		}
		// A fresh navigation unloads all editor handlers and unsaved DOM. Run
		// reads the persisted page with exactly the public runtime and ACLs.
		const url = new URL(window.location.href);
		url.pathname = `/${standalone ? 't' : 'p'}/${encodeURIComponent(result.id || draft.resolved!.page!.id)}`;
		url.searchParams.delete('page');
		if (standalone) url.searchParams.delete('mode');
		else url.searchParams.set('mode', 'run');
		window.location.assign(url.href);
	};

	const topControls = (
		<Flex data-testid="builder-top-controls" gap={2} alignItems="center" flexWrap="wrap" paddingY={3} paddingX={3}>
			<Button as={Link} to="/builder" size="xs" variant="link">
				← My pages
			</Button>
			<Button
				as="a"
				href={`/p/${encodeURIComponent(draft.resolved?.page?.id || '')}`}
				target="_blank"
				rel="noopener noreferrer"
				size="xs"
				variant="link"
			>
				Go to page ↗
			</Button>
			<Select
				aria-label="Preview size"
				width="auto"
				maxWidth="100%"
				size="sm"
				value={preset}
				onChange={(event) => {
					const id = event.target.value;
					finishEdit.current?.();
					setPreset(id);
					const device = VIEWPORT_PRESETS.find((item) => item.id === id);
					onViewport(id === 'full' ? null : device ? { width: device.width, height: device.height } : viewport || { width: 390, height: 844 });
				}}
			>
				{VIEWPORT_PRESETS.map((item) => (
					<option key={item.id} value={item.id}>
						{item.label}
					</option>
				))}
				<option value="custom">Custom dimensions</option>
			</Select>
			{preset === 'custom' && (
				<Flex gap={2} maxWidth="100%">
					<Input
						aria-label="Preview width"
						type="number"
						min={240}
						max={3840}
						width="88px"
						size="sm"
						defaultValue={viewport?.width || 390}
						onBlur={(event) => { const width = boundViewportDimension(Number(event.target.value), 390); event.target.value = String(width); onViewport({ width, height: viewport?.height || 844 }); }}
					/>
					<Input
						aria-label="Preview height"
						type="number"
						min={240}
						max={3840}
						width="88px"
						size="sm"
						defaultValue={viewport?.height || 844}
						onBlur={(event) => { const height = boundViewportDimension(Number(event.target.value), 844); event.target.value = String(height); onViewport({ width: viewport?.width || 390, height }); }}
					/>
				</Flex>
			)}
		</Flex>
	);

	return (
		<>
			<style>{`
        [class~="tt.devKit"] { display: none !important; }
        .lopuLauncher { top: auto !important; bottom: calc(var(--tt-builder-toolbar-clearance, 160px) + env(safe-area-inset-bottom, 0px)) !important; }
        html[data-lopu-sheet="open"] [data-testid="builder-mode-toolbar"] { visibility: hidden; }
      `}</style>
			{document.getElementById('builder-top-controls-slot')
				? createPortal(topControls, document.getElementById('builder-top-controls-slot')!)
				: topControls}

			{createPortal(
				<>
					{running && <Box position="fixed" inset={0} zIndex={10200} cursor="wait" aria-label="Saving page" />}
					<Flex
						ref={toolbar}
						data-testid="builder-mode-toolbar"
				role="toolbar"
						aria-label="Page mode"
						position="fixed"
						bottom="max(16px, env(safe-area-inset-bottom))"
						left="50%"
						transform="translateX(-50%)"
						width="max-content"
						maxWidth="calc(100vw - 24px)"
						padding="6px"
						gap="4px"
						zIndex={10100}
						background="var(--tt-card, #fff)"
						border="1px solid var(--tt-border, #ddd)"
						borderRadius="16px"
						boxShadow="0 4px 24px #0002"
						flexWrap="wrap"
						justifyContent="center"
					>
						{(['edit', 'view', 'layout', 'builder', 'container'] as const).map((item) => (
							<Button key={item} size="sm" aria-pressed={mode === item} variant={mode === item ? 'solid' : 'ghost'} onClick={() => changeMode(item)}>
								{item[0].toUpperCase() + item.slice(1)}
							</Button>
						))}
						<Button size="sm" variant="ghost" onClick={() => run()} isLoading={running} title="Save and open the page without builder UI">
							Run
						</Button>
						<Button size="sm" variant="ghost" onClick={() => run(true)} isDisabled={running} title="Save and open without Thingtime navigation">
							Standalone ↗
						</Button>
						<Button size="sm" variant="outline" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(!drawerOpen)}>
							Inspector
						</Button>
					</Flex>
					{drawerOpen && (
						<BuilderDrawer
							hideTransfer={mode === 'view'}
							onSaved={(id) => {
								if (id !== draft.resolved?.page?.id) navigate(`/builder?page=${encodeURIComponent(id)}`);
							}}
							title="Seamless builder"
							draft={draft}
							selectedId={builder.selectedId}
							onDeselect={builder.deselect}
							onClose={() => setDrawerOpen(false)}
							mode="page"
							pageName={pageName}
							onPageName={setPageName}
							audienceAcl={acl}
							onAudienceAcl={setAcl}
							onUploadToBlock={builder.uploadToBlock}
							helpText={HELP[mode]}
							footerSpace="var(--tt-builder-toolbar-clearance, 160px)"
						/>
					)}
					{mode === 'layout' || mode === 'builder' || mode === 'container' ? builder.insertMenu : null}
				</>,
				document.body
			)}
		</>
	);
}
