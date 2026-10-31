import { validOptionalLibraryTitle } from '../libraryTitle';
import type { TransferThing } from './format';

export const isTransferTheme = (thing: Pick<TransferThing, 'thingtime'>): boolean => thing.thingtime.length === 1 && thing.thingtime[0] === 'theme';

export const validateTransferTheme = (thing: TransferThing): void => {
	if (
		!isTransferTheme(thing) ||
		thing.targetId ||
		thing.extended != null ||
		thing.tags?.length ||
		Object.keys(thing.crystal).some((key) => key !== 'name' && key !== 'theme' && key !== 'title')
	) {
		throw new Error('Theme transfers contain only a name, theme tokens, optional display title and folder placement');
	}
	if ('title' in thing.crystal && !validOptionalLibraryTitle(thing.crystal.title)) throw new Error('Invalid theme display title');
	if (
		typeof thing.crystal.name !== 'string' ||
		!thing.crystal.name.trim() ||
		thing.crystal.name.length > 60 ||
		!thing.crystal.theme ||
		typeof thing.crystal.theme !== 'object' ||
		Array.isArray(thing.crystal.theme)
	) {
		throw new Error('A theme transfer requires a name and theme token object');
	}
};
