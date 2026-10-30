import { slug } from './types';

export const LIBRARY_BUILDER_INDEX = 'webpage-integrations';
export const libraryServicePageId = (provider: string) => `webpage-integrations-service-${slug(provider)}`;
export const libraryExamplePageId = (id: string) => `webpage-integrations-example-${id}`;
export const libraryBuilderHref = (id = LIBRARY_BUILDER_INDEX) => `/builder?page=${encodeURIComponent(id)}&mode=view`;
