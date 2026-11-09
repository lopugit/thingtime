/** Browser fixtures only implement the settings-document transport. */
export function settingsFixtureCapabilities(origin: string) {
  return {
    schemaVersion: 1,
    origin,
    features: {
      'api.actions-run': { version: '1.7.0' },
      'api.mongodb-endpoint': { version: '1.1.0' },
      'api.things': { version: '1.36.0' },
      'api.webpages-resolve': { version: '1.6.0' }
    }
  };
}
