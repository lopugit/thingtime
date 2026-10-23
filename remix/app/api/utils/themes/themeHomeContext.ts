import { isDataPlane } from '../../../utils/dataPlane';

/** The selected-plane header still fences the current session. This context
 * declares the home destination and preserves a frozen receipt's original key. */
export type ThemeHomeContext = { storagePlane: 'home'; receiptPlane: string };
export function parseThemeHomeContext(input: unknown): ThemeHomeContext {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid home theme context');
	const value = input as Record<string, unknown>;
	if (
		Object.keys(value).length !== 2 ||
		Object.keys(value).some((key) => !['storagePlane', 'receiptPlane'].includes(key)) ||
		value.storagePlane !== 'home' ||
		!isDataPlane(value.receiptPlane)
	)
		throw new Error('Invalid home theme context');
	return { storagePlane: 'home', receiptPlane: value.receiptPlane };
}
