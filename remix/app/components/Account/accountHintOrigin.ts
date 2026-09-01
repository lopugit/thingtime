export type AccountHintOriginPresentation = {
	origin: string;
	host: string;
	environment: string;
};

const hostFromOrigin = (origin: string) => {
	try {
		return new URL(origin).host;
	} catch {
		return origin;
	}
};

// An account hint names the deployment where this browser has a live session.
// That origin does not prove which database the deployment is configured to
// use, so the labels intentionally describe the deploy environment visible in
// the URL rather than claiming a data-plane environment we cannot verify.
export const accountHintOriginPresentation = (origin: string): AccountHintOriginPresentation => {
	const host = hostFromOrigin(origin).toLowerCase();
	const preview = /^pr-(\d+)\.previews\.dev\.thingtime\.com(?::\d+)?$/.exec(host);

	if (host === 'thingtime.com' || host === 'www.thingtime.com') {
		return { origin, host: hostFromOrigin(origin), environment: 'Production' };
	}
	if (preview) {
		return { origin, host: hostFromOrigin(origin), environment: `Dev preview · PR #${preview[1]}` };
	}
	if (host.endsWith('.previews.dev.thingtime.com')) {
		return { origin, host: hostFromOrigin(origin), environment: 'Dev preview' };
	}
	if (host === 'dev.thingtime.com' || host === 'develop.thingtime.com' || host.endsWith('.dev.thingtime.com')) {
		return { origin, host: hostFromOrigin(origin), environment: 'Develop' };
	}
	if (host === 'localhost' || host.startsWith('localhost:') || host === '127.0.0.1' || host.startsWith('127.0.0.1:') || host === '[::1]') {
		return { origin, host: hostFromOrigin(origin), environment: 'Local' };
	}
	if (host.endsWith('.vercel.app')) {
		return { origin, host: hostFromOrigin(origin), environment: 'Vercel preview' };
	}
	return { origin, host: hostFromOrigin(origin), environment: 'Other deployment' };
};

export const accountHintOriginsSummary = (origins: Array<{ origin: string }>) => {
	const labels = origins.map((entry) => accountHintOriginPresentation(entry.origin).environment);
	return [...new Set(labels)].join(', ');
};
