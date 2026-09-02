import { Box, Flex, Text } from '@chakra-ui/react';

import { useTtCustomClasses, useTtTheme } from '~/hooks/useTtTheme';

import { PET_DEVKIT_CLEARANCE, petAnimation, petDisplay, petInset, petMotionEnabled, petVisible } from './petCore';

/**
 * 🦄 Lopuuuuuuuuuu — an app-wide decorative pet, rendered by Main.
 *
 * Purely ornamental: `pointerEvents: none` and a low z-index keep it under all
 * real chrome (nav 9999, Commander 10050, DevKit 99999) and out of every
 * interaction. Motion is opt-out twice over, per docs/design/DESIGN_LANGUAGE.md
 * and the eggs.ts house rule that delight is "never annoying, always polite
 * about motion":
 *   - `prefers-reduced-motion` via CSS, so it lands on the first paint
 *   - the theme's Motion switch (Settings → Motion), so it is user-controllable
 * With motion off the pet stays put and simply doesn't animate.
 *
 * Visibility is a third, separate control (Settings → Pet). This is permanent
 * chrome on every non-full-bleed page, so per AI_ALL.md's "Feature
 * customization defaults" it ships with an off switch; default on, so nothing
 * changes for anyone who never opens Settings.
 *
 * That switch is honoured in two tiers, because `theme.general` is Tier 2 (the
 * async localforage blob) and cannot decide a first paint:
 *   - `display: var(--tt-pet-display)`, written by themeToCssVars and reapplied
 *     pre-paint by tt-boot.js, so a pet-off user never sees it flash
 *   - this component's unmount, once the stored value is readable, so a pet-off
 *     user doesn't keep an inert node (and its emoji glyphs) in the DOM
 */
export const LopuuuPet = () => {
	const { theme } = useTtTheme();
	const motion = petMotionEnabled(theme?.general);
	// Above the early return: hooks must run in the same order on every render,
	// and the pet unmounts below when it is switched off.
	const customClasses = useTtCustomClasses('general.pet');

	// Defaults to on, so this only ever fires *after* hydration hands back a
	// stored `pet: false` — never on the pre-hydration default, which would
	// unmount the pet out from under everyone for a tick. The pre-paint var
	// above has already hidden it by then, so there is nothing to flash.
	if (!petVisible(theme?.general)) return null;

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
			// ...and steps left of the DevKit bubble rather than under it — see
			// PET_DEVKIT_CLEARANCE. The pet is pointerEvents:none at z-index 20,
			// so the collision was never a blocked click; it was a 74px unicorn
			// rendered behind the dev bubble on every non-production build.
			// `tt-pet` is the stable selector TT_CUSTOM_TARGETS['general.pet']
			// scopes custom CSS to — keep the two in step (customise.test.ts).
			className={customClasses ? `tt-pet ${customClasses}` : 'tt-pet'}
			// The first-paint half of the Pet switch — see petDisplay. Must stay a
			// var rather than a JS read: the stored answer isn't available yet on
			// the render that decides what the user first sees.
			display={petDisplay()}
			pointerEvents="none"
			position="fixed"
			right={petInset(PET_DEVKIT_CLEARANCE, 'right')}
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
