/** Non-secret, server-only branch build policy. Change to dedicated on an opt-in
 * branch before building; Nitro bundles this choice into immutable deployments.
 * Runtime THINGTIME_MONGODB_CONNECTION_MODE may explicitly override it. */
export const mongoConnectionPolicy: 'proxy' | 'dedicated' = 'dedicated';
