// Public, isomorphic catalogue. Authored actions select a provider, never a URL.
// Adding a provider requires a bounded server adapter and contract tests.
export const ACTION_LOOKUP_PROVIDERS = {
	'google-geocoding': { label: 'Google Maps address lookup', attribution: 'Google Maps', maxQueryChars: 500 }
} as const;
export type ActionLookupProvider = keyof typeof ACTION_LOOKUP_PROVIDERS;
export const isActionLookupProvider = (value: unknown): value is ActionLookupProvider =>
	typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTION_LOOKUP_PROVIDERS, value);
