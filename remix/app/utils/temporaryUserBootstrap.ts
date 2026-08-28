import type { RootLoaderData } from '~/root-data.server';

export const shouldBootstrapTemporaryUser = (pathname: string, user: RootLoaderData['user']): boolean => {
	const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	return normalizedPath === '/things' && !user;
};
