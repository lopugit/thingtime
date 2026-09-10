export const parseRecordingReference = (value: string, origin: string) => {
	let id = value.trim();
	if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) {
		const url = new URL(id);
		const match = /^\/(?:thing|post)\/([^/]+)\/?$/.exec(url.pathname);
		if (url.origin !== origin || url.username || url.password || !match)
			throw new Error('Choose a recording link from this Thingtime domain or paste its Thing ID.');
		id = decodeURIComponent(match[1]);
	}
	if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error('Choose a valid recording Thing ID.');
	return id;
};
