import { useRouteLoaderData } from 'react-router';
import { isDataPlane } from '../utils/dataPlane';

/** Root identity invalidation also covers database changes in every open tab. */
export function useDataPlane(): string | null {
	const data = useRouteLoaderData('root') as { dataPlane?: unknown } | undefined;
	return isDataPlane(data?.dataPlane) ? data.dataPlane : null;
}
