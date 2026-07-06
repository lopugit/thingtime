import { Global } from '@emotion/react';

export const GlobalStyles = () => {
	return (
		<Global
			styles={{
				':root': {
					'--thingtime-safe-area-top': 'env(safe-area-inset-top, 0px)',
					'--thingtime-safe-area-right': 'env(safe-area-inset-right, 0px)',
					'--thingtime-safe-area-bottom': 'env(safe-area-inset-bottom, 0px)',
					'--thingtime-safe-area-left': 'env(safe-area-inset-left, 0px)',
					'--thingtime-devkit-bottom-offset': '20px'
				},
				html: {
					background: 'white',
					minHeight: '100%',
					'@supports (height: 100dvh)': {
						minHeight: '100dvh'
					}
				},
				body: {
					background: 'white',
					minHeight: '100%',
					margin: 0,
					'@supports (height: 100dvh)': {
						minHeight: '100dvh'
					}
				},
				'html.thingtime-native-webview': {
					'--thingtime-devkit-bottom-offset': '36px'
				},
				'html.thingtime-native-webview .drawerTrigger': {
					display: 'none'
				},
				'html.thingtime-native-webview .thingtimeFooter': {
					paddingBottom: 'calc(72px + var(--thingtime-safe-area-bottom, 0px)) !important'
				},
				'input[data-com-onepassword-filled="light"]': {
					// Doesn't seem to work..?
					background: 'pink !important'
				}
			}}
		/>
	);
};
