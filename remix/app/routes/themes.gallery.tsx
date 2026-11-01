import { Flex } from '@chakra-ui/react';

import { ThemeGallery } from '~/components/ThemeSettings/ThemeGallery';

// /themes/gallery — browsable grid of every public shared theme with Apply +
// Copy-link (claude-todo/10 ✨).
export default function ThemesGallery() {
	return (
		<Flex justifyContent="center" width="100%" paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))">
			<ThemeGallery />
		</Flex>
	);
}
