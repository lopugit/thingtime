import React from 'react';
import {
	Box,
	Button,
	Flex,
	Input,
	Select,
	Text,
	Popover,
	PopoverTrigger,
	PopoverContent,
	PopoverBody,
	PopoverCloseButton,
	Portal,
	Menu,
	MenuButton,
	MenuList,
	MenuItem,
	MenuDivider,
	MenuOptionGroup,
	MenuItemOption
} from '@chakra-ui/react';
import { Link, useNavigate } from 'react-router';
import { createPortal, flushSync } from 'react-dom';

import { useLopu } from '../Lopu/useLopu';
import { drawerWidthCss, useDrawer, useDrawerLiveWidth, useIsMobileViewport, DRAWER_POPUP_Z, LOPU_WINDOW_Z } from '../Nav/Drawer/useDrawer';
import { defaultsFromArgs, sanitizeArgSpecs } from '../ComponentsLibrary/componentTemplate';
import { BuilderDrawer } from './BuilderDrawer';
import type { BuilderChrome } from './WebpageBlocksRenderer';
import { useBuilderChrome } from './useBuilderChrome';
import { findBlock, updateBlock, type WebpageBlock } from './webpageBlocks';
import type { UseWebpageDraft } from './useWebpage';
import { componentTextOverrides } from './componentTextOverrides';
import { VIEWPORT_PRESETS, boundViewportDimension, type BuilderViewportSize } from './BuilderViewport';
import { matchingTextArg, type SeamlessMode } from './seamlessMode';

const EDITOR_MODES = ['builder', 'edit', 'layout', 'view'] as const;
const PAGE_POPUP_MODIFIERS = [{ name: 'preventOverflow', options: { altAxis: true, tether: false, padding: 12 } }];
const modeLabel = (mode: SeamlessMode) => mode[0].toUpperCase() + mode.slice(1);

const HELP = {
	edit: 'Click text to edit, drag the pink handles to arrange, or use + to add blocks. Save publishes your changes.',
	view: 'Use the live page. Forms, links and actions work normally; the inspector stays available.',
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
	const builder = useBuilderChrome(draft, { enabled: mode !== 'view' });
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
	const [openControl, setOpenControl] = React.useState<'mode' | 'viewport' | null>(null);
	React.useLayoutEffect(() => {
		onChrome(chrome);
	}, [chrome, onChrome]);
	React.useLayoutEffect(() => () => onChrome(null), [onChrome]);
	const current = React.useRef({ draft, chrome });
	current.current = { draft, chrome };
	const toolbar = React.useRef<HTMLDivElement>(null);
	const controlsLayer = React.useRef<HTMLDivElement>(null);
	// Use the same containing viewport as navigation. Lopu resizes this host
	// for every split direction, including top/bottom; body portals escape it.
	const pageHost = document.getElementById('lopuPageViewport') || document.body;
	const drawer = useDrawer();
	const { width: navDrawerWidth, resizing: navDrawerResizing } = useDrawerLiveWidth();
	const mobileViewport = useIsMobileViewport();
	const navInset = drawer.open && !mobileViewport ? drawerWidthCss(navDrawerWidth) : '0px';
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
	}, [pageHost]);
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
			if (
				target.isContentEditable ||
				target.closest('.ttInsertZone, .ttDropWell, .ttBlockChip, .ttChipAction, .ttBlockContextMenu, .ttInlineRichTextEditor, .ttArgEditPopover')
			)
				return;
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
		// A fresh navigation unloads all editor handlers and unsaved DOM. Visit
		// reads the persisted page with exactly the public runtime and ACLs.
		const url = new URL(window.location.href);
		url.pathname = `/${standalone ? 't' : 'p'}/${encodeURIComponent(result.id || draft.resolved!.page!.id)}`;
		url.searchParams.delete('page');
		if (standalone) url.searchParams.delete('mode');
		else url.searchParams.set('mode', 'visit');
		window.location.assign(url.href);
	};

	const presentation = viewport?.presentation === 'container' ? 'container' : 'viewport';
	const changeViewport = (id: string, kind = presentation) => {
		finishEdit.current?.();
		setPreset(id);
		const device = VIEWPORT_PRESETS.find((item) => item.id === id);
		onViewport(
			id === 'full' && kind === 'viewport'
				? null
				: {
						width: device ? device.width : viewport?.width || 390,
						height: device ? device.height : viewport?.height || 844,
						presentation: kind as 'container' | 'viewport'
				  }
		);
	};
	const previewControls = (
		<Popover
			isOpen={openControl === 'viewport'}
			onOpen={() => setOpenControl('viewport')}
			onClose={() => setOpenControl(null)}
			placement="top"
			boundary={controlsLayer.current || undefined}
			modifiers={PAGE_POPUP_MODIFIERS}
			isLazy
		>
			<PopoverTrigger>
				<Button size="sm" variant="ghost" aria-label="Viewport controls" title="Viewport and container preview">
					{presentation === 'container' ? 'Container' : preset === 'full' ? 'Full width' : 'Viewport'}{' '}
					<Box as="span" marginLeft={2} color="var(--tt-muted, #777)">
						⌄
					</Box>
				</Button>
			</PopoverTrigger>
			<Portal containerRef={controlsLayer}>
				<PopoverContent
					zIndex={DRAWER_POPUP_Z}
					pointerEvents="auto"
					width="min(340px, calc(100cqw - 24px))"
					maxHeight="calc(100cqh - 24px)"
					overflowY="auto"
					borderRadius="16px"
					background="var(--tt-card, #fff)"
					boxShadow="0 8px 40px #0002"
					border="1px solid var(--tt-border, #ddd)"
				>
					<PopoverCloseButton aria-label="Close viewport controls" />
					<PopoverBody padding={4}>
						<Text fontSize="sm" fontWeight={600} marginBottom={3}>
							Page preview
						</Text>
						<Flex
							role="group"
							aria-label="Preview presentation"
							gap={1}
							padding={1}
							background="var(--tt-surface, #f5f5f7)"
							borderRadius="10px"
							marginBottom={3}
						>
							{(['viewport', 'container'] as const).map((kind) => (
								<Button
									key={kind}
									flex={1}
									size="sm"
									variant={presentation === kind ? 'solid' : 'ghost'}
									aria-pressed={presentation === kind}
									onClick={() => changeViewport(preset, kind)}
								>
									{kind === 'viewport' ? 'Viewport' : 'Container'}
								</Button>
							))}
						</Flex>
						<Select
							aria-label="Preview size"
							value={preset}
							onChange={(event) => changeViewport(event.target.value)}
							height="38px"
							border="1px solid var(--tt-border, #ddd)"
							borderRadius="8px"
							fontSize="sm"
							background="var(--tt-card, #fff)"
						>
							{VIEWPORT_PRESETS.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
							<option value="custom">Custom dimensions</option>
						</Select>
						{preset === 'custom' && (
							<Flex gap={3} marginTop={3}>
								{(['width', 'height'] as const).map((dimension) => (
									<Box key={dimension} flex={1} minWidth={0}>
										<Text as="label" htmlFor={`preview-${dimension}`} fontSize="xs" color="var(--tt-muted, #777)">
											{dimension === 'width'
												? presentation === 'container'
													? 'Max width'
													: 'Width'
												: presentation === 'container'
												? 'Min height'
												: 'Height'}
										</Text>
										<Input
											id={`preview-${dimension}`}
											aria-label={`Preview ${dimension}`}
											type="number"
											min={240}
											max={3840}
											size="sm"
											borderRadius="8px"
											defaultValue={viewport?.[dimension] || (dimension === 'width' ? 390 : 844)}
											onBlur={(event) => {
												const value = boundViewportDimension(Number(event.target.value), dimension === 'width' ? 390 : 844);
												event.target.value = String(value);
												onViewport({ width: viewport?.width || 390, height: viewport?.height || 844, presentation, [dimension]: value });
											}}
										/>
									</Box>
								))}
							</Flex>
						)}
						<Text fontSize="xs" color="var(--tt-muted, #777)" marginTop={3}>
							{presentation === 'container'
								? 'A centered container that grows with your content. Height is a minimum; media queries use the browser window.'
								: 'Device sizes preview real media queries. Full width uses the live page.'}
						</Text>
					</PopoverBody>
				</PopoverContent>
			</Portal>
		</Popover>
	);

	return (
		<>
			<style>{`
        [class~="tt.devKit"] { display: none !important; }
        .lopuLauncher { top: auto !important; bottom: calc(var(--tt-builder-toolbar-clearance, 160px) + env(safe-area-inset-bottom, 0px)) !important; }
        html[data-lopu-sheet="open"] [data-testid="builder-controls-layer"] { visibility: hidden; }
        html[data-lopu-docked] #lopuPageViewport:not([data-lopu-split]) [data-testid="builder-controls-layer"] { z-index: ${LOPU_WINDOW_Z - 1}; }
        .ttBuilderCompactModes { display: none; }
        @container builder-controls (max-width: 940px) {
          .ttBuilderWideModes { display: none; }
          .ttBuilderCompactModes { display: inline-flex; }
          .ttBuilderControlsDivider { display: none; }
        }
        @container builder-controls (max-width: 560px) {
          .ttBuilderPageLinks { flex-basis: 100%; }
          [data-testid="builder-mode-toolbar"] button,
          [data-testid="builder-mode-toolbar"] a { padding-inline: 10px; font-size: 13px; }
        }
        [data-testid="builder-controls-layer"] button,
        [data-testid="builder-controls-layer"] a { white-space: nowrap; }
        #lopuPageViewport .ttBuilderDrawer { max-width: calc(100% - 24px); }
      `}</style>

			{createPortal(
				<>
					{running && <Box position="fixed" inset={0} zIndex={10200} cursor="wait" aria-label="Saving page" />}
					<Box
						ref={controlsLayer}
						data-testid="builder-controls-layer"
						position="fixed"
						top={0}
						bottom={0}
						left={drawer.direction === 'left' ? navInset : 0}
						right={drawer.direction === 'right' ? navInset : 0}
						transition={drawer.loading || navDrawerResizing ? 'none' : 'left 0.28s ease-out, right 0.28s ease-out'}
						pointerEvents="none"
						zIndex={openControl ? DRAWER_POPUP_Z : 10100}
						sx={{ containerType: 'size', containerName: 'builder-controls' }}
					>
						<Flex
							ref={toolbar}
							data-testid="builder-mode-toolbar"
							role="toolbar"
							aria-label="Page controls"
							position="absolute"
							pointerEvents="auto"
							bottom="max(12px, env(safe-area-inset-bottom))"
							left="50%"
							transform="translateX(-50%)"
							width="max-content"
							maxWidth="calc(100% - 24px)"
							padding="8px"
							gap="3px"
							background="var(--tt-card, #fff)"
							border="1px solid var(--tt-border, #ddd)"
							borderRadius="20px"
							boxShadow="0 4px 24px #0002"
							flexWrap="wrap"
							justifyContent="center"
						>
							<Flex className="ttBuilderPageLinks" alignItems="center" justifyContent="center" flexWrap="wrap" maxWidth="100%" gap={1}>
								<Button as={Link} to="/builder" size="sm" variant="ghost">
									← My pages
								</Button>
								<Button
									as="a"
									href={`/p/${encodeURIComponent(draft.resolved?.page?.id || '')}`}
									target="_blank"
									rel="noopener noreferrer"
									size="sm"
									variant="ghost"
								>
									Go to page ↗
								</Button>
							</Flex>
							{previewControls}
							<Box
								className="ttBuilderControlsDivider"
								alignSelf="center"
								width="1px"
								height="24px"
								background="var(--tt-border, #ddd)"
								marginX={1}
								display={['none', 'block']}
							/>
							<Flex className="ttBuilderWideModes" gap="3px">
								{EDITOR_MODES.map((item) => (
									<Button
										key={item}
										size="sm"
										aria-pressed={mode === item}
										variant={mode === item ? 'solid' : 'ghost'}
										onClick={() => changeMode(item)}
									>
										{modeLabel(item)}
									</Button>
								))}
								<Button size="sm" variant="ghost" onClick={() => run()} isLoading={running} title="Save and open the page without builder UI">
									Visit ↗
								</Button>
								<Button size="sm" variant="ghost" onClick={() => run(true)} isDisabled={running} title="Save and open without Thingtime navigation">
									Deploy ↗
								</Button>
							</Flex>
							<Menu
								isOpen={openControl === 'mode'}
								onOpen={() => setOpenControl('mode')}
								onClose={() => setOpenControl(null)}
								placement="top"
								boundary={controlsLayer.current || undefined}
								modifiers={PAGE_POPUP_MODIFIERS}
								isLazy
							>
								<MenuButton as={Button} className="ttBuilderCompactModes" size="sm" isLoading={running} aria-label={`Page mode: ${modeLabel(mode)}`}>
									{modeLabel(mode)}{' '}
									<Box as="span" marginLeft={2} aria-hidden>
										⌃
									</Box>
								</MenuButton>
								<Portal containerRef={controlsLayer}>
									<MenuList
										zIndex={DRAWER_POPUP_Z}
										pointerEvents="auto"
										minWidth="0"
										width="min(220px, calc(100cqw - 24px))"
										maxHeight="calc(100cqh - 24px)"
										overflowY="auto"
										borderRadius="14px"
									>
										<MenuOptionGroup value={mode} type="radio" title="Page mode">
											{EDITOR_MODES.map((item) => (
												<MenuItemOption key={item} value={item} onClick={() => changeMode(item)}>
													{modeLabel(item)}
												</MenuItemOption>
											))}
										</MenuOptionGroup>
										<MenuDivider />
										<MenuItem onClick={() => run()} isDisabled={running}>
											Visit ↗
										</MenuItem>
										<MenuItem onClick={() => run(true)} isDisabled={running}>
											Deploy ↗
										</MenuItem>
									</MenuList>
								</Portal>
							</Menu>
							<Button size="sm" variant="outline" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(!drawerOpen)}>
								Inspector
							</Button>
						</Flex>
					</Box>
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
					{mode !== 'view' ? builder.insertMenu : null}
				</>,
				pageHost
			)}
		</>
	);
}
