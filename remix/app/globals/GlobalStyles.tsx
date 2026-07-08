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
				'html.thingtime-electron-desktop .thingtimeTopNav': {
					zIndex: '10050 !important',
					left: '0 !important',
					right: '0 !important',
					transform: 'none !important',
					height: 'var(--thingtime-electron-titlebar-height, 52px) !important',
					minHeight: 'var(--thingtime-electron-titlebar-height, 52px) !important',
					WebkitAppRegion: 'drag',
					userSelect: 'none'
				},
				'html.thingtime-electron-desktop .thingtimeTopNavInner, html.thingtime-electron-desktop .thingtimeTopNav #commander, html.thingtime-electron-desktop .thingtimeTopNav .nav-left-section, html.thingtime-electron-desktop .thingtimeTopNav .nav-right-section':
					{
						WebkitAppRegion: 'drag',
						userSelect: 'none'
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
					zIndex: '10070 !important',
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
				'html.thingtime-electron-desktop .thingtimeTopNav .electron-titlebar-home-button, html.thingtime-electron-desktop .thingtimeTopNav .electron-titlebar-search-button':
					{
						width: '36px',
						height: '36px',
						borderRadius: '8px'
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
					paddingTop: '18px'
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
