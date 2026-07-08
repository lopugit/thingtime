import { Global } from '@emotion/react';

import { themeToCssVars, THINGTIME_THEME } from '../theme/tokens';

// Default --tt-* design tokens, derived from the default theme so the
// pre-React paint matches what ThemeHost will (re)apply at runtime.
const ttThemeDefaults = themeToCssVars(THINGTIME_THEME);

export const GlobalStyles = () => {
	return (
		<Global
			styles={{
				':root': {
					...ttThemeDefaults,
					// Height of the fixed global nav bar — pages that need to clear it
					// (landing sub-nav, /themes) read this instead of a magic number.
					'--tt-nav-clearance': '54px',
					// Docs-suite accent (kept out of user themes deliberately).
					'--tt-docs-accent': '#008060',
					'--tt-docs-accent-hover': '#006e52',
					'--tt-docs-accent-soft': '#d7f5df',
					'--tt-docs-accent-ink': '#0f5132',
					'--thingtime-safe-area-top': 'env(safe-area-inset-top, 0px)',
					'--thingtime-safe-area-right': 'env(safe-area-inset-right, 0px)',
					'--thingtime-safe-area-bottom': 'env(safe-area-inset-bottom, 0px)',
					'--thingtime-safe-area-left': 'env(safe-area-inset-left, 0px)',
					'--thingtime-visual-bottom-padding': '72px',
					'--thingtime-visual-devkit-bottom-offset': '36px',
					'--thingtime-devkit-bottom-offset': '20px'
				},
				html: {
					background: 'var(--tt-page-bg, white)',
					minHeight: '100%',
					'@supports (height: 100dvh)': {
						minHeight: '100dvh'
					}
				},
				body: {
					background: 'var(--tt-page-bg, white)',
					color: 'var(--tt-ink, #16161a)',
					fontFamily: 'var(--tt-font-body, system-ui, sans-serif)',
					minHeight: '100%',
					margin: 0,
					'@supports (height: 100dvh)': {
						minHeight: '100dvh'
					}
				},
				// Shared design-language keyframes (see docs/design/DESIGN_LANGUAGE.md).
				'@keyframes moving-rainbow': {
					'0%': { backgroundPosition: '0 0' },
					'100%': { backgroundPosition: 'calc(100px + 200%) 0' }
				},
				'@keyframes tt-pan': {
					to: { backgroundPosition: '200% center' }
				},
				'@keyframes tt-blink': {
					'0%, 100%': { opacity: 1 },
					'50%': { opacity: 0 }
				},
				'@keyframes tt-pop': {
					from: { opacity: 0, transform: 'translateY(10px)' },
					to: { opacity: 1, transform: 'none' }
				},
				'@keyframes tt-toast-in': {
					from: { opacity: 0, transform: 'translateY(-12px) scale(0.97)' },
					to: { opacity: 1, transform: 'none' }
				},
				'@keyframes tt-bob': {
					'0%, 100%': { transform: 'translateY(0)' },
					'50%': { transform: 'translateY(6px)' }
				},
				// 🥚 Easter egg: the nav unicorn's victory gallop (7-click streak).
				'@keyframes tt-gallop': {
					'0%': { transform: 'translateX(0) rotate(0deg)' },
					'15%': { transform: 'translateX(14px) rotate(-8deg) translateY(-3px)' },
					'40%': { transform: 'translateX(60px) rotate(6deg) translateY(0)' },
					'60%': { transform: 'translateX(30px) rotate(-6deg) translateY(-4px)' },
					'80%': { transform: 'translateX(8px) rotate(4deg)' },
					'100%': { transform: 'translateX(0) rotate(0deg)' }
				},
				'html.thingtime-native-webview': {
					'--thingtime-devkit-bottom-offset': 'var(--thingtime-visual-devkit-bottom-offset, 36px)'
				},
				'html.thingtime-native-webview .drawerTrigger': {
					display: 'none'
				},
				'html.thingtime-native-webview .thingtimeFooter': {
					paddingBottom:
						'calc(var(--thingtime-visual-bottom-padding, 72px) + var(--thingtime-safe-area-bottom, 0px)) !important'
				},
				'input[data-com-onepassword-filled="light"]': {
					// Doesn't seem to work..?
					background: 'pink !important'
				}
			}}
		/>
	);
};
