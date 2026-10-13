/** A device's full Things view. The id stays in the existing account-scoped device selector. */
export const deviceThingsPageHref = (deviceId: string): string =>
	`/things?${new URLSearchParams({ device: deviceId, deviceView: 'page' }).toString()}`;
