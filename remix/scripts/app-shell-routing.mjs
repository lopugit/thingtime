// Which page requests need the server-generated <head>, and which can take the
// static Vite shell straight from the CDN.
//
// Browsers render every screen client-side, so the per-page Open Graph/Twitter
// tags only matter to link unfurlers and crawlers, which do not run JavaScript.
// Sending every browser navigation through the __server function made the page
// shell the largest single source of function invocations (~45K a day in
// November 2026; see NOTES/vercel-cost-reduction-2026-11-25.md). Browsers now get
// the identical static shell with the same no-store headers; everything else,
// including requests with no user-agent, still reaches the social controller.

// A real browser engine. Crawlers often claim this prefix too, which is why the
// unfurler pattern below is checked as well.
export const BROWSER_USER_AGENT = '^Mozilla/5\\.0 ';

// Link unfurlers, crawlers, preview fetchers and HTTP tools. Listed without
// inline flags so the pattern means the same thing in every regex engine Vercel
// might evaluate it with. A false positive only costs one function call; a false
// negative would give that client a generic card, so the list errs wide.
export const UNFURLER_USER_AGENT = [
	'[Bb]ot', '[Cc]rawl', '[Ss]pider', '[Ss]lurp', '[Pp]review', '[Ee]mbed', '[Ii]framely', '[Uu]nfurl',
	'facebookexternalhit', 'Facebot', 'meta-external', 'WhatsApp', 'Telegram', 'Discord', 'Slack', 'Skype',
	'vkShare', 'Pinterest', 'reddit', 'Tumblr', 'Mastodon', 'Bluesky', 'Cardyb', 'outbrain', '[Qq]uora',
	'Nuzzel', 'Qwantify', 'Flipboard', 'Yandex', 'Baidu', 'DuckDuck', 'Applebot', 'LinkedIn', 'KakaoTalk',
	'Snapchat', 'Viber', 'Line/', 'W3C_Validator', 'Lighthouse', 'Headless', 'Google-', 'Mediapartners',
	'Feedfetcher', 'Feedly', 'ChatGPT', 'GPTBot', 'OAI-', 'Claude', 'Perplexity', 'Bytespider', 'CCBot',
	'ia_archiver', 'curl/', 'Wget', 'python', 'Go-http', 'Java/', 'okhttp', 'axios', 'node-fetch', 'undici'
].join('|');

// Route conditions that select a browser navigation.
export const browserOnly = {
	has: [{ type: 'header', key: 'user-agent', value: BROWSER_USER_AGENT }],
	missing: [{ type: 'header', key: 'user-agent', value: UNFURLER_USER_AGENT }]
};

// True when a route carries exactly the browser conditions above.
export function isBrowserOnlyRoute(route) {
	return JSON.stringify(route?.has) === JSON.stringify(browserOnly.has) &&
		JSON.stringify(route?.missing) === JSON.stringify(browserOnly.missing);
}

// Mirrors Vercel's evaluation of the two conditions, for tests and probes.
export function isBrowserUserAgent(userAgent) {
	if (typeof userAgent !== 'string') return false;
	return new RegExp(BROWSER_USER_AGENT).test(userAgent) && !new RegExp(UNFURLER_USER_AGENT).test(userAgent);
}
