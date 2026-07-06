import { Global } from '@emotion/react';

export const GlobalStyles = () => {
	return (
		<Global
			styles={{
				':root': {
					'--thingtime-safe-area-top': 'env(safe-area-inset-top, 0px)',
					'--thingtime-safe-area-right': 'env(safe-area-inset-right, 0px)',
					'--thingtime-safe-area-bottom': 'env(safe-area-inset-bottom, 0px)',
					'--thingtime-safe-area-left': 'env(safe-area-inset-left, 0px)'
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
				'input[data-com-onepassword-filled="light"]': {
					// Doesn't seem to work..?
					background: 'pink !important'
				}
			}}
		/>
	);
};
