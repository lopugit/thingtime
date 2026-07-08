import React from 'react';

import { useThingtime } from '../Thingtime/useThingtime';
import { useLopu } from '../Lopu/useLopu';
import { installKonami, partyMode } from '~/eggs/eggs';
import { installConsoleEgg } from '~/eggs/consoleEgg';

/**
 * 🥚 Renderless host for the app-wide easter eggs:
 *  - the Konami code (↑↑↓↓←→←→ B A) → party mode + a Lopu salute
 *  - the `window.tt` console API + rainbow boot banner
 *
 * Mounted once in root.tsx inside ThingtimeProvider (needs the thingtime tree)
 * and ChakraWrapper (Lopu uses the Chakra toast). Renders nothing.
 */
export const EasterEggs = () => {
	const { getThingtime, setThingtime, paths } = useThingtime();
	const lopu = useLopu();

	// keep the latest values without re-installing listeners each render
	const ref = React.useRef({ getThingtime, setThingtime, paths, lopu });
	ref.current = { getThingtime, setThingtime, paths, lopu };

	React.useEffect(() => {
		const cleanupKonami = installKonami(() => {
			partyMode();
			ref.current.lopu({
				title: '🌈 PARTY MODE 🦄',
				description: 'You found the Konami code. Thingtime salutes you, explorer.',
				status: 'success'
			});
		});

		installConsoleEgg({
			get: (path?: string) => ref.current.getThingtime(path),
			set: (path: string, value: any) => ref.current.setThingtime(path, value, { namespace: 'user' }),
			paths: () => ref.current.paths || [],
			toast: (title: string, description?: string) => ref.current.lopu({ title, description, status: 'info' }),
			confetti: () => partyMode(),
			help: () => {}
		});

		return () => {
			cleanupKonami();
		};
	}, []);

	return null;
};
