export const APPLE_APP_ASSOCIATION_PATH = '/.well-known/apple-app-site-association';
// Public Apple application identifiers, never signing keys. Fail closed for
// absent/malformed configuration; forks must name their own signed app IDs.
export const appleAppAssociation = (raw = process.env.THINGTIME_APPLE_APP_IDS || '') => ({
	webcredentials: {
		apps: [
			...new Set(
				raw
					.split(',')
					.map((id) => id.trim())
					.filter((id) => /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(id))
			)
		].slice(0, 10)
	}
});
