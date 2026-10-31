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
					// Lopu toasts (Chakra's toast lists read this) sit above the drawer,
					// its popups, and modals (useDrawer's z ladder tops out at 10250) so a
					// note fired from an open drawer or dialog is never hidden behind it;
					// DevKit (99999) stays above everything.
					'--toast-z-index': '10260',
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
					'--thingtime-devkit-bottom-offset': '20px',
					'--thingtime-electron-titlebar-height': '0px',
					'--thingtime-electron-titlebar-left-inset': '0px',
					'--thingtime-electron-titlebar-nav-start': '34px'
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
				'html.thingtime-native-webview .thingtimeFooter': {
					paddingBottom: 'calc(var(--thingtime-visual-bottom-padding, 72px) + var(--thingtime-safe-area-bottom, 0px)) !important'
				},
				'html.thingtime-electron-desktop .thingtimeTopNav': {
					// Keep the chrome above the drawer's temporary hover/focus lift
					// (10120), while popovers and the trigger still sit above it.
					zIndex: '10130 !important',
					left: '0 !important',
					right: '0 !important',
					transform: 'none !important',
					height: 'var(--thingtime-electron-titlebar-height, 52px) !important',
					minHeight: 'var(--thingtime-electron-titlebar-height, 52px) !important',
					WebkitAppRegion: 'drag',
					userSelect: 'none'
				},
				// Only the 52px titlebar background is draggable. In particular,
				// Commander lives below it when closed; marking that host as drag
				// made toasts beneath the titlebar unclickable and unselectable.
				'html.thingtime-electron-desktop .thingtimeTopNav #commander, html.thingtime-electron-desktop .thingtimeTopNav .nav-left-section, html.thingtime-electron-desktop .thingtimeTopNav .nav-right-section':
					{
						WebkitAppRegion: 'no-drag',
						userSelect: 'auto'
					},
				'html.thingtime-electron-desktop .thingtimeTopNavInner': {
					height: 'var(--thingtime-electron-titlebar-height, 52px) !important',
					minHeight: 'var(--thingtime-electron-titlebar-height, 52px) !important',
					marginTop: '0 !important',
					marginBottom: '0 !important',
					paddingTop: '0 !important',
					paddingBottom: '0 !important',
					paddingLeft: '0 !important',
					paddingRight: '0 !important'
				},
				'html.thingtime-electron-desktop .drawerTrigger': {
					// Above both the fixed titlebar and the drawer's temporary
					// hover/focus lift, so the trigger cannot disappear beneath either.
					zIndex: '10140 !important',
					top: 'calc(var(--thingtime-safe-area-top, 0px) + 8px) !important',
					left: 'var(--thingtime-electron-titlebar-left-inset, 88px) !important',
					width: '36px !important',
					height: '36px !important'
				},
				'html.thingtime-electron-desktop .thingtimeTopNav .nav-left-section': {
					position: 'fixed',
					top: 'calc(var(--thingtime-safe-area-top, 0px) + 8px)',
					left: 'var(--thingtime-electron-titlebar-nav-start, 132px)',
					height: '36px',
					alignItems: 'center',
					columnGap: '8px',
					paddingLeft: '0 !important',
					zIndex: 10060
				},
				'html.thingtime-electron-desktop .thingtimeTopNav .electron-titlebar-navigation-button, html.thingtime-electron-desktop .thingtimeTopNav .electron-titlebar-home-button, html.thingtime-electron-desktop .thingtimeTopNav .electron-titlebar-search-button':
					{
						width: '36px',
						height: '36px',
						borderRadius: '8px'
					},
				'html.thingtime-electron-desktop .thingtimeTopNav .electron-titlebar-navigation-button, html.thingtime-electron-desktop .thingtimeTopNav .electron-titlebar-account-button':
					{
						display: 'flex !important'
					},
				'html.thingtime-electron-desktop .thingtimeTopNav .electron-titlebar-account-button': {
					height: '36px',
					paddingLeft: '8px',
					paddingRight: '8px',
					borderRadius: '8px'
				},
				'html.thingtime-electron-desktop .thingtimeTopNav .nav-right-account-button': {
					display: 'none !important'
				},
				'html.thingtime-electron-desktop .thingtimeTopNav .electron-titlebar-home-button > a': {
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: '100%',
					height: '100%'
				},
				'html.thingtime-electron-desktop .thingtimeTopNav a, html.thingtime-electron-desktop .thingtimeTopNav button, html.thingtime-electron-desktop .thingtimeTopNav input, html.thingtime-electron-desktop .thingtimeTopNav textarea, html.thingtime-electron-desktop .thingtimeTopNav select, html.thingtime-electron-desktop .thingtimeTopNav [role="button"], html.thingtime-electron-desktop .thingtimeTopNav [contenteditable="true"], html.thingtime-electron-desktop .drawerTrigger':
					{
						WebkitAppRegion: 'no-drag',
						userSelect: 'auto'
					},
				'html.thingtime-electron-desktop .drawerContentHeader': {
					display: 'none'
				},
				'html.thingtime-electron-desktop .drawerMenuScroll': {
					paddingTop: '0'
				},
				'html.thingtime-electron-desktop .lopuToast': {
					WebkitAppRegion: 'no-drag',
					userSelect: 'text'
				},
				'html.thingtime-electron-desktop #commander[data-commander-active="false"] #commander-suggestions': {
					display: 'none'
				},
				'input[data-com-onepassword-filled="light"]': {
					// Doesn't seem to work..?
					background: 'pink !important'
				}
			}}
		/>
	);
};
