import React from 'react';
import { Box, Flex, Input } from '@chakra-ui/react';
import { normalizeWatchCodeInput, watchCodeSlotCount } from './watchCodeInputCore';

/** One native text input owns selection, paste, autofill and accessibility.
 * The squares are decorative, not separate one-character inputs. */
export const WatchCodeField = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
	const inputRef = React.useRef<HTMLInputElement>(null);
	const [focused, setFocused] = React.useState(false);
	const [selection, setSelection] = React.useState({ start: 0, end: 0 });
	const count = watchCodeSlotCount(value);
	const selectSlot = (index: number) => {
		const input = inputRef.current;
		if (!input) return;
		const start = Math.min(index, value.length);
		input.focus();
		input.setSelectionRange(start, Math.min(start + 1, value.length));
		setSelection({ start, end: Math.min(start + 1, value.length) });
	};

	return (
		<Box position="relative" width="100%" maxWidth={count === 4 ? '320px' : '100%'} mx="auto" my={3}>
			<Flex aria-hidden="true" gap={{ base: 2, md: 3 }} pointerEvents="none">
				{Array.from({ length: count }, (_, index) => {
					const active =
						focused &&
						(selection.start === selection.end ? index === Math.min(selection.start, count - 1) : index >= selection.start && index < selection.end);
					return (
						<Flex
							key={index}
							data-watch-code-slot
							align="center"
							justify="center"
							flex="1"
							minWidth={0}
							position="relative"
							sx={{ '&::before': { content: '""', display: 'block', paddingTop: '100%' } }}
							border="1px solid"
							borderColor={active ? 'var(--tt-ink, #16161a)' : 'var(--tt-border, #e7e7ed)'}
							borderRadius={count === 4 ? '12px' : '8px'}
							background="var(--tt-card, white)"
							boxShadow={active ? '0 0 0 4px rgba(212, 101, 185, .16)' : undefined}
							fontFamily="mono"
							fontSize={count === 4 ? '28px' : { base: '17px', md: '22px' }}
							fontWeight={700}
							color="var(--tt-ink, #16161a)"
						>
							<Flex position="absolute" inset={0} align="center" justify="center">
								{value[index] || (active ? <Box width="2px" height="24px" borderRadius="full" background="currentColor" /> : null)}
							</Flex>
						</Flex>
					);
				})}
			</Flex>
			{/* Keep the saved-password badge off the last square; native OTP autofill remains enabled. */}
			<Input
				ref={inputRef}
				id="watch-code"
				aria-label="Approval code"
				aria-describedby="watch-code-help"
				value={value}
				type="text"
				inputMode="numeric"
				autoComplete="one-time-code"
				data-1p-ignore="true"
				autoCapitalize="characters"
				spellCheck={false}
				maxLength={8}
				position="absolute"
				inset={0}
				width="100%"
				height="100%"
				border={0}
				padding={0}
				background="transparent"
				color="transparent"
				fontSize="24px"
				cursor="text"
				_focusVisible={{ boxShadow: 'none', border: 0 }}
				sx={{ caretColor: 'transparent', '&::selection': { background: 'transparent', color: 'transparent' } }}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onSelect={(event) => setSelection({ start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 })}
				onChange={(event) => onChange(normalizeWatchCodeInput(event.target.value))}
				onPaste={(event) => {
					event.preventDefault();
					const code = normalizeWatchCodeInput(event.clipboardData.getData('text'));
					if (!code) return;
					onChange(code);
					requestAnimationFrame(() => {
						inputRef.current?.setSelectionRange(code.length, code.length);
						setSelection({ start: code.length, end: code.length });
					});
				}}
				onPointerDown={(event) => {
					event.preventDefault();
					const rect = event.currentTarget.getBoundingClientRect();
					selectSlot(Math.min(count - 1, Math.max(0, Math.floor((event.clientX - rect.left) / (rect.width / count)))));
				}}
			/>
		</Box>
	);
};
