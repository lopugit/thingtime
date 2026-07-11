import { useContext } from 'react';
import type React from 'react';
import type { Subject } from 'rxjs';
import { ThingtimeContext } from '~/Providers/ThingtimeProvider';

export interface ThingtimeTypes {
	thingtime: any;
	set: any;
	setThingtime: any;
	getThingtime: any;
	thingtimeRef: any;
	loading: boolean;
	paths: string[];
	events: Subject<any>;
	Provider?: React.Context<ThingtimeTypes> | any;
}

export interface EverythingTypes {
	Everything: ThingtimeTypes;
}

// export const ThingtimeContext = createContext<EverythingTypes | null>(null);

export const useThingtime = (_uuidProp?: string): ThingtimeTypes => {
	const { Everything } = useContext(ThingtimeContext);
	return Everything;
};
