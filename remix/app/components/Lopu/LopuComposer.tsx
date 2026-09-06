import React from 'react';
import { Box, Flex, Popover, PopoverBody, PopoverContent, PopoverTrigger, Text, Textarea } from '@chakra-ui/react';
import { ArrowUp, Settings2, Square } from 'lucide-react';

import { useIsMobileViewport } from '../Nav/Drawer/useDrawer';
import { LopuModelPicker, LopuToggle } from './LopuModelPicker';
import type { AiModelPublic, LopuChatDefaults, LopuChatSettings, LopuVaultInfo, LopuVaultProvider } from './lopuChatStore';
import { LOPU_UI, lopuChipSx, lopuEyebrowSx, lopuFocusRingSx, lopuPopoverSx, lopuReducedMotionSx } from './lopuTheme';

// The chat composer (design brief): ONE rounded field — an auto-growing
// textarea (Enter sends, Shift+Enter breaks the line; on mobile Enter always
// breaks and the button sends) with a left cluster (model chip → picker,
// the mic slot W2 fills through `composerLeading`, the "Editing · <page>"
// context chip when a builder draft is mounted) and, on the right, a gear
// that opens the session settings as a compact popover and the primary
// action on the rainbow: send, or stop while Lopu streams.

const MAX_TEXTAREA_HEIGHT = 168;
export const LOPU_MAX_MESSAGE_CHARS = 8000;

export type LopuComposerPreferences = { enterSends: boolean; applyPatches: boolean; confirmDeletes: boolean };

export type LopuComposerProps = {
	value: string;
	onChange: (next: string) => void;
	onSend: (text: string) => void;
	onStop: () => void;
	streaming: boolean;
	disabled?: boolean;
	enterSends?: boolean;
	placeholder?: string;
	models: AiModelPublic[];
	vaultProviders?: LopuVaultProvider[] | null;
	vault?: LopuVaultInfo | null;
	settings: LopuChatSettings;
	defaults?: LopuChatDefaults | null;
	onSettingsChange: (patch: Partial<LopuChatSettings>) => void;
	contextLabel?: string | null;
	compact?: boolean;
	autoFocus?: boolean;
	// the textarea, so the view can hand focus back after a send
	inputRef?: React.Ref<HTMLTextAreaElement>;
	// the mic / voice control (W2) rendered in the left cluster
	composerLeading?: React.ReactNode;
	// session preferences shown in the gear popover, plus extra rows (voice)
	preferences?: LopuComposerPreferences;
	onPreferencesChange?: (patch: Partial<LopuComposerPreferences>) => void;
	settingsContent?: React.ReactNode;
	hideSettings?: boolean;
};

// The primary action: a rainbow ring (send) or an ink ring (stop) around a
// card-coloured disc — the same treatment as Lopu's avatar and launcher.
const ActionButton = ({ kind, size, disabled = false, onClick, label }: { kind: 'send' | 'stop'; size: number; disabled?: boolean; onClick: () => void; label: string }) => (
	<Box
		as="button"
		type="button"
		className={kind === 'send' ? 'lopuSend' : 'lopuStop'}
		aria-label={label}
		title={label}
		disabled={disabled}
		width={`${size}px`}
		height={`${size}px`}
		flexShrink={0}
		p="2px"
		borderRadius="999px"
		background={disabled ? LOPU_UI.borderColor : kind === 'send' ? LOPU_UI.rainbow : LOPU_UI.ink}
		backgroundSize="calc(100px + 200%)"
		cursor={disabled ? 'not-allowed' : 'pointer'}
		transition={`transform ${LOPU_UI.transitionFast}, opacity ${LOPU_UI.transitionFast}`}
		_hover={disabled ? undefined : { transform: 'scale(1.04)' }}
		_active={disabled ? undefined : { transform: 'scale(0.97)' }}
		sx={{ animation: disabled || kind === 'stop' ? 'none' : LOPU_UI.rainbowAnim, ...lopuReducedMotionSx, ...lopuFocusRingSx }}
		onClick={onClick}
	>
		<Flex align="center" justify="center" width="100%" height="100%" borderRadius="999px" bg={LOPU_UI.card} color={disabled ? LOPU_UI.faint : LOPU_UI.ink}>
			{kind === 'send' ? <ArrowUp size={Math.round(size * 0.45)} strokeWidth={2.4} aria-hidden /> : <Square size={Math.round(size * 0.3)} strokeWidth={2} fill="currentColor" aria-hidden />}
		</Flex>
	</Box>
);

const SettingsRow = ({ label, hint, control }: { label: string; hint?: string; control: React.ReactNode }) => (
	<Flex align="center" gap={3} py={1.5}>
		<Box minW={0} flex={1}>
			<Text fontSize={LOPU_UI.fontSmall} fontWeight={600} color={LOPU_UI.ink} lineHeight="1.3">
				{label}
			</Text>
			{hint ? (
				<Text fontSize="11px" color={LOPU_UI.muted} lineHeight="1.3">
					{hint}
				</Text>
			) : null}
		</Box>
		<Box flexShrink={0}>{control}</Box>
	</Flex>
);

const IconButton = ({ label, size, onClick, children, pressed }: { label: string; size: number; onClick?: () => void; children: React.ReactNode; pressed?: boolean }) => (
	<Box
		as="button"
		type="button"
		aria-label={label}
		title={label}
		aria-pressed={pressed}
		data-lopu-control
		display="inline-flex"
		alignItems="center"
		justifyContent="center"
		width={`${size}px`}
		height={`${size}px`}
		flexShrink={0}
		borderRadius="999px"
		color={LOPU_UI.muted}
		cursor="pointer"
		transition={`background ${LOPU_UI.transitionFast}, color ${LOPU_UI.transitionFast}`}
		_hover={{ bg: LOPU_UI.surfaceHover, color: LOPU_UI.ink }}
		sx={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation', ...lopuFocusRingSx }}
		onClick={onClick}
	>
		{children}
	</Box>
);

export const LopuComposer = ({
	value,
	onChange,
	onSend,
	onStop,
	streaming,
	disabled = false,
	enterSends = true,
	placeholder,
	models,
	vaultProviders,
	vault,
	settings,
	defaults,
	onSettingsChange,
	contextLabel,
	compact = false,
	autoFocus = false,
	inputRef,
	composerLeading,
	preferences,
	onPreferencesChange,
	settingsContent,
	hideSettings = false
}: LopuComposerProps) => {
	const isMobile = useIsMobileViewport();
	const ownRef = React.useRef<HTMLTextAreaElement | null>(null);
	const setRefs = React.useCallback(
		(element: HTMLTextAreaElement | null) => {
			ownRef.current = element;
			if (typeof inputRef === 'function') inputRef(element);
			else if (inputRef && typeof inputRef === 'object') (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = element;
		},
		[inputRef]
	);
	const canSend = !disabled && !streaming && value.trim().length > 0;
	const controlSize = isMobile ? LOPU_UI.touchTarget : compact ? 30 : 36;
	const iconSize = isMobile ? LOPU_UI.touchTarget : compact ? 28 : 32;
	const bodySize = compact ? LOPU_UI.fontCompact : LOPU_UI.fontBody;

	// auto-grow to the content, capped — the list above keeps its own scroll
	React.useLayoutEffect(() => {
		const element = ownRef.current;
		if (!element) return;
		element.style.height = 'auto';
		element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
		element.style.overflowY = element.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
	}, [value, compact]);

	const submit = React.useCallback(() => {
		const text = value.trim();
		if (!text || disabled || streaming) return;
		onSend(text.slice(0, LOPU_MAX_MESSAGE_CHARS));
	}, [value, disabled, streaming, onSend]);

	const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== 'Enter') return;
		// an IME is still composing — Enter confirms the composition, never sends
		if (event.nativeEvent.isComposing || (event as unknown as { keyCode?: number }).keyCode === 229) return;
		if (isMobile || !enterSends) {
			// Cmd/Ctrl+Enter always sends, even where Enter is a newline
			if (event.metaKey || event.ctrlKey) {
				event.preventDefault();
				submit();
			}
			return;
		}
		if (event.shiftKey) return;
		event.preventDefault();
		submit();
	};

	const hint = isMobile ? null : enterSends ? 'Enter to send · Shift+Enter for a new line' : 'Shift+Enter for a new line · ⌘Enter to send';
	const showSettings = !hideSettings && (!!preferences || !!settingsContent);

	return (
		<Box className="lopuComposerWrap" minW={0} maxW="100%" sx={{ '&, & *': { boxSizing: 'border-box' } }}>
			<Box
				className="lopuComposer"
				data-compact={compact ? 'true' : 'false'}
				data-streaming={streaming ? 'true' : 'false'}
				border={LOPU_UI.border}
				borderRadius={compact ? LOPU_UI.radiusLg : LOPU_UI.radiusXl}
				bg={LOPU_UI.card}
				transition={`border-color ${LOPU_UI.transitionFast}`}
				_focusWithin={{ borderColor: LOPU_UI.ink }}
				opacity={disabled ? 0.7 : 1}
				minW={0}
			>
				<Textarea
					ref={setRefs}
					value={value}
					onChange={(event) => onChange(event.target.value.slice(0, LOPU_MAX_MESSAGE_CHARS))}
					onKeyDown={onKeyDown}
					placeholder={placeholder || (streaming ? 'Lopu is replying…' : 'Ask Lopu anything, or tell her what to build…')}
					aria-label="Message Lopu"
					rows={1}
					width="100%"
					maxW="100%"
					minW={0}
					boxSizing="border-box"
					minH={compact ? '40px' : '46px'}
					maxH={`${MAX_TEXTAREA_HEIGHT}px`}
					resize="none"
					variant="unstyled"
					fontSize={bodySize}
					lineHeight="1.5"
					color={LOPU_UI.ink}
					px={compact ? 3 : 3.5}
					pt={compact ? 2.5 : 3}
					pb={1}
					isDisabled={disabled}
					autoFocus={autoFocus}
					whiteSpace="pre-wrap"
					_placeholder={{ color: LOPU_UI.faint }}
					sx={{ '&:focus, &:focus-visible': { boxShadow: 'none', outline: 'none' } }}
				/>
				<Flex align="center" gap={1.5} px={compact ? 1.5 : 2} pb={compact ? 1.5 : 2} pt={0.5} minW={0}>
					<LopuModelPicker models={models} vaultProviders={vaultProviders} vault={vault} value={settings} defaults={defaults} onChange={onSettingsChange} compact={compact} disabled={disabled} mobile={isMobile} />
					{composerLeading ? (
						<Box display="inline-flex" alignItems="center" flexShrink={0} data-lopu-control>
							{composerLeading}
						</Box>
					) : null}
					{contextLabel ? (
						<Box
							as="span"
							className="lopuContextChip"
							sx={{ ...lopuChipSx, cursor: 'default', height: `${compact ? 26 : LOPU_UI.controlCompact}px`, maxWidth: compact ? '120px' : '180px', _hover: {} }}
							title="Lopu can see and edit this page while it is open in the builder"
							minW={0}
						>
							<Text as="span" sx={lopuEyebrowSx} color={LOPU_UI.muted} flexShrink={0}>
								Editing
							</Text>
							<Text as="span" isTruncated minW={0}>
								{contextLabel}
							</Text>
						</Box>
					) : null}
					<Box flex={1} minW={0} />
					{showSettings ? (
						<Popover placement="top-end" isLazy strategy="fixed" gutter={8}>
							<PopoverTrigger>
								<Box as="span" display="inline-flex">
									<IconButton label="Chat settings" size={iconSize}>
										<Settings2 size={16} strokeWidth={2} aria-hidden />
									</IconButton>
								</Box>
							</PopoverTrigger>
							<PopoverContent width="300px" maxW="calc(100vw - 24px)" sx={lopuPopoverSx} _focus={{ outline: 'none', boxShadow: LOPU_UI.shadowPopover }} _focusVisible={{ outline: 'none', boxShadow: LOPU_UI.shadowPopover }} aria-label="Chat settings">
								<PopoverBody px={3} py={2}>
									<Text as="span" display="block" sx={lopuEyebrowSx} pt={1} pb={1}>
										This chat
									</Text>
									{preferences ? (
										<>
											<SettingsRow
												label="Enter sends"
												hint="Shift+Enter adds a line"
												control={<LopuToggle checked={preferences.enterSends} onChange={(next) => onPreferencesChange?.({ enterSends: next })} label="Enter sends the message" />}
											/>
											<SettingsRow
												label="Apply builder changes live"
												hint="Edits paint into the open draft while Lopu types"
												control={<LopuToggle checked={preferences.applyPatches} onChange={(next) => onPreferencesChange?.({ applyPatches: next })} label="Apply builder changes live" />}
											/>
											<SettingsRow
												label="Confirm conversation deletes"
												hint="Ask before deleting a conversation from the list"
												control={<LopuToggle checked={preferences.confirmDeletes} onChange={(next) => onPreferencesChange?.({ confirmDeletes: next })} label="Confirm conversation deletes" />}
											/>
										</>
									) : null}
									{settingsContent ? (
										<Box borderTop={preferences ? LOPU_UI.border : undefined} pt={preferences ? 2 : 0} mt={preferences ? 1 : 0}>
											{settingsContent}
										</Box>
									) : null}
								</PopoverBody>
							</PopoverContent>
						</Popover>
					) : null}
					{streaming ? <ActionButton kind="stop" size={controlSize} onClick={onStop} label="Stop Lopu's reply" /> : <ActionButton kind="send" size={controlSize} disabled={!canSend} onClick={submit} label={isMobile || !enterSends ? 'Send' : 'Send (Enter)'} />}
				</Flex>
			</Box>
			{hint && !compact ? (
				<Text fontSize="11px" color={LOPU_UI.faint} mt={1.5} px={1} display={{ base: 'none', md: 'block' }} aria-hidden="true">
					{hint}
				</Text>
			) : null}
		</Box>
	);
};
