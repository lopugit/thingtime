import React from 'react';
import { Box, Button, Flex, Text, Textarea } from '@chakra-ui/react';

import { useIsMobileViewport } from '../Nav/Drawer/useDrawer';
import { LopuModelPicker } from './LopuModelPicker';
import type { AiModelPublic, LopuChatSettings, LopuProviderTemplatePublic, LopuVaultProviderPublic } from './lopuChatStore';

// The chat composer (design note §3.2): an auto-growing textarea (Enter
// sends, Shift+Enter breaks the line — on mobile Enter always breaks and the
// button sends), the model picker, the "✏️ editing: <page>" context chip when
// a builder draft is mounted, a Stop button while Lopu streams, and Send.

const MUTED = 'var(--tt-muted, #9a9aa6)';
const MAX_TEXTAREA_HEIGHT = 168;
export const LOPU_MAX_MESSAGE_CHARS = 8000;

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
	vaultProviders?: LopuVaultProviderPublic[];
	providerTemplates?: LopuProviderTemplatePublic[];
	settings: LopuChatSettings;
	defaults?: LopuChatSettings | null;
	onSettingsChange: (patch: Partial<LopuChatSettings>) => void;
	contextLabel?: string | null;
	compact?: boolean;
	autoFocus?: boolean;
};

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
	providerTemplates,
	settings,
	defaults,
	onSettingsChange,
	contextLabel,
	compact = false,
	autoFocus = false
}: LopuComposerProps) => {
	const isMobile = useIsMobileViewport();
	const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
	const canSend = !disabled && !streaming && value.trim().length > 0;

	// auto-grow to the content, capped — the list above keeps its own scroll
	React.useLayoutEffect(() => {
		const element = textareaRef.current;
		if (!element) return;
		element.style.height = 'auto';
		element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
		element.style.overflowY = element.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
	}, [value]);

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

	const hint = isMobile ? null : enterSends ? 'Enter to send · Shift+Enter for a new line' : 'Shift+Enter or ⌘Enter to send';

	return (
		<Box
			className="lopuComposer"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="16px"
			bg="var(--tt-card, #ffffff)"
			boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
			px={3}
			pt={2}
			pb={2}
			transition="border-color 120ms"
			_focusWithin={{ borderColor: 'var(--tt-accent, #7c6cff)' }}
		>
			{contextLabel ? (
				<Flex align="center" gap={2} mb={1.5}>
					<Box
						as="span"
						fontSize="11px"
						fontWeight={600}
						color="var(--tt-ink, #16161a)"
						bg="var(--tt-surface-alt, #f5f5f7)"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="999px"
						px={2}
						py="2px"
						maxW="100%"
						title="Lopu can see and edit this page while it is open in the builder"
						isTruncated
					>
						✏️ editing: {contextLabel}
					</Box>
				</Flex>
			) : null}
			<Textarea
				ref={textareaRef}
				value={value}
				onChange={(event) => onChange(event.target.value.slice(0, LOPU_MAX_MESSAGE_CHARS))}
				onKeyDown={onKeyDown}
				placeholder={placeholder || (streaming ? 'Lopu is replying…' : 'Ask Lopu anything, or tell her what to build…')}
				aria-label="Message Lopu"
				rows={1}
				minH="36px"
				maxH={`${MAX_TEXTAREA_HEIGHT}px`}
				resize="none"
				variant="unstyled"
				fontSize="sm"
				lineHeight="1.5"
				px={0}
				py={1}
				isDisabled={disabled}
				autoFocus={autoFocus}
				whiteSpace="pre-wrap"
			/>
			<Flex align="center" gap={2} mt={1} wrap="wrap">
				<LopuModelPicker
					models={models}
					vaultProviders={vaultProviders}
					providerTemplates={providerTemplates}
					value={settings}
					defaults={defaults}
					onChange={onSettingsChange}
					compact={compact}
					disabled={disabled}
				/>
				{hint && !compact ? (
					<Text fontSize="10px" color={MUTED} display={{ base: 'none', md: 'block' }}>
						{hint}
					</Text>
				) : null}
				<Box flex={1} />
				{streaming ? (
					<Button size="xs" variant="outline" height="28px" px={3} onClick={onStop} borderColor="var(--tt-border, #ececef)" title="Stop Lopu's reply">
						◼ Stop
					</Button>
				) : (
					<Button
						size="xs"
						height="28px"
						px={3}
						onClick={submit}
						isDisabled={!canSend}
						bg="var(--tt-accent, #7c6cff)"
						color="var(--tt-accent-contrast, #ffffff)"
						_hover={{ opacity: 0.92 }}
						_disabled={{ opacity: 0.45, cursor: 'not-allowed' }}
						title={isMobile || !enterSends ? 'Send' : 'Send (Enter)'}
					>
						Send ↑
					</Button>
				)}
			</Flex>
		</Box>
	);
};
