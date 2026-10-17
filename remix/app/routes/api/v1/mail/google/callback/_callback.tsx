import { googleMailOAuth } from '~/api/utils/mail/googleOAuth';
export function createGoogleMailCallback(callback = googleMailOAuth.callback) {
	return async ({ request }: { request: Request }) => {
		let ok = false;
		if (request.method === 'GET') {
			try {
				await callback(request);
				ok = true;
			} catch {
				/* Never render provider, code or state details. */
			}
		}
		return new Response(
			`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thingtime Gmail connection</title><body><main><h1>${
				ok ? 'Google authorization received' : 'Google connection not completed'
			}</h1><p>${
				ok
					? 'Return to Thingtime Email settings to confirm your Gmail address and finish connecting.'
					: 'Return to Thingtime Email settings and start the Google connection again.'
			}</p><p>You can close this tab.</p></main></body></html>`,
			{
				status: ok ? 200 : 400,
				headers: {
					'Content-Type': 'text/html; charset=utf-8',
					'Cache-Control': 'private, no-store',
					'Referrer-Policy': 'no-referrer',
					'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
					'X-Content-Type-Options': 'nosniff'
				}
			}
		);
	};
}
export const loader = createGoogleMailCallback();
