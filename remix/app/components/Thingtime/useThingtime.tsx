import { useContext } from 'react';
import { ThingtimeContext } from '~/Providers/ThingtimeProvider';
import type { EverythingTypes, ThingtimeTypes } from '~/Providers/ThingtimeProvider';

// The canonical ThingtimeTypes/EverythingTypes live in ThingtimeProvider.tsx
// (single source of truth — this file used to carry a drifted duplicate).
// Re-exported so existing `import { ThingtimeTypes } from '~/components/
// Thingtime/useThingtime'` consumers keep working.
export type { EverythingTypes, ThingtimeTypes };

export const useThingtime = (_uuidProp?: string): ThingtimeTypes => {
	const { Everything } = useContext(ThingtimeContext);
	return Everything;
};
