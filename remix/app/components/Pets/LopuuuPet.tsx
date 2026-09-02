import { Box, Flex, Text } from '@chakra-ui/react';

import { useTtTheme } from '~/hooks/useTtTheme';

import { petAnimation, petInset, petMotionEnabled } from './petCore';

/**
 * 🦄 Lopuuuuuuuuuu — an app-wide decorative pet, rendered by Main.
 *
 * Purely ornamental: `pointerEvents: none` and a low z-index keep it under all
 * real chrome (nav 10050, DevKit 99999) and out of every interaction. Motion is
 * opt-out twice over, per docs/design/DESIGN_LANGUAGE.md and the eggs.ts house
 * rule that delight is "never annoying, always polite about motion":
 *   - `prefers-reduced-motion` via CSS, so it lands on the first paint
 *   - the theme's Motion switch (Settings → Motion), so it is user-controllable
 * With motion off the pet stays put and simply doesn't animate.
 */
export const LopuuuPet = () => {
	const { theme } = useTtTheme();
	const motion = petMotionEnabled(theme?.general);

	return (
		<Box
			// Ornament, not content: the pet carries no information a screen
			// reader user would miss, and it is mounted on every non-full-bleed
			// page. An accessible name here would announce it once per route
			// change forever, which is the annoying end of the eggs.ts "delight,
			// never annoying" rule. Same convention as every other decorative
			// visual in the app (attachment/status icons, MediaLayoutControls).
			aria-hidden="true"
			// bottom-anchored fixed chrome clears the home indicator / rounded
			// corners, same as DevKit's bubble and the footer
			bottom={{ base: petInset(16, 'bottom'), md: petInset(24, 'bottom') }}
			pointerEvents="none"
			position="fixed"
			right={{ base: petInset(12, 'right'), md: petInset(24, 'right') }}
			sx={{
				'@keyframes lopuuu-float': {
					'0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(-2deg)' },
					'50%': { transform: 'translate3d(0, -10px, 0) rotate(2deg)' }
				},
				'@keyframes lopuuu-sparkle': {
					'0%, 100%': { opacity: 0.45, transform: 'scale(0.9)' },
					'50%': { opacity: 1, transform: 'scale(1.12)' }
				},
				'@keyframes lopuuu-rainbow': {
					'0%': { filter: 'hue-rotate(0deg)' },
					'100%': { filter: 'hue-rotate(360deg)' }
				},
				// first-paint correct, and covers the case where the OS setting
				// changes mid-session without a re-render
				'@media (prefers-reduced-motion: reduce)': {
					'*': { animation: 'none !important' }
				}
			}}
			zIndex={20}
		>
			<Flex alignItems="center" animation={petAnimation('lopuuu-float 4.8s ease-in-out infinite', motion)} flexDirection="column" gap={1}>
				<Flex
					alignItems="center"
					background="linear-gradient(135deg, rgba(255,255,255,0.94), rgba(255,240,253,0.86))"
					border="1px solid rgba(255,255,255,0.7)"
					borderRadius="999px"
					boxShadow="0 12px 42px rgba(174, 68, 255, 0.28)"
					color="purple.700"
					fontSize={{ base: '10px', md: 'xs' }}
					fontWeight="800"
					gap={1}
					letterSpacing="0.02em"
					px={3}
					py={1}
					textShadow="0 1px 0 rgba(255,255,255,0.8)"
					whiteSpace="nowrap"
				>
					<Text as="span">Lopuuuuuuuuuu</Text>
					<Text as="span">💖</Text>
				</Flex>

				<Box position="relative">
					<Text
						animation={petAnimation('lopuuu-rainbow 7s linear infinite', motion)}
						fontSize={{ base: '56px', md: '74px' }}
						lineHeight="1"
						textShadow="0 10px 28px rgba(120, 44, 255, 0.35)"
					>
						🦄
					</Text>
					<Text
						animation={petAnimation('lopuuu-sparkle 1.8s ease-in-out infinite', motion)}
						fontSize={{ base: '18px', md: '24px' }}
						left="-16px"
						position="absolute"
						top="2px"
					>
						✨
					</Text>
					<Text
						animation={petAnimation('lopuuu-sparkle 2.3s ease-in-out infinite 0.35s', motion)}
						fontSize={{ base: '18px', md: '24px' }}
						position="absolute"
						right="-18px"
						top="16px"
					>
						🧠
					</Text>
					<Text
						animation={petAnimation('lopuuu-sparkle 2s ease-in-out infinite 0.7s', motion)}
						bottom="0"
						fontSize={{ base: '18px', md: '22px' }}
						position="absolute"
						right="-12px"
					>
						🌈
					</Text>
				</Box>
			</Flex>
		</Box>
	);
};
