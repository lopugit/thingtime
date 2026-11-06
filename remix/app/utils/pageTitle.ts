import { automaticRoutePreview, DEFAULT_ROUTE_PAGE_TITLE } from './automaticRoutePreview';

// Client and server share defaults discovered from the actual router. Unknown
// paths and all dynamic parameter values remain absent from document copy.
export const DEFAULT_PAGE_TITLE = DEFAULT_ROUTE_PAGE_TITLE;
export const pageTitle = (pathname: string, prefix = ''): string => {
	const title = automaticRoutePreview(pathname)?.routeTitle || DEFAULT_PAGE_TITLE;
	return prefix ? `${prefix} ${title}` : title;
};
