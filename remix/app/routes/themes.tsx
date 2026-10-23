import { Flex } from '@chakra-ui/react';

import { ThemeStudio } from '~/components/ThemeSettings/ThemeStudio';

// /themes — the Theme Studio: live theme editing, presets, saved + shareable
// themes (?apply=<shareId> applies a shared theme).
export default function Themes() {
	return (
		<Flex justifyContent="center" width="100%" paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))">
			<ThemeStudio />
		</Flex>
	);
}
