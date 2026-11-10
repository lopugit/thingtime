import { resolveRoster } from './accounts';
import { resolvePublicOrigin } from './publicOrigin';
import type { RosterAccount } from './accounts';

// FedCM (Federated Credential Management) — Thingtime as a browser-recognized
// identity provider. The BROWSER (never the page) fetches these endpoints with
// the user's first-party thingtime.com cookies and renders its own native
// "Continue as …" sheet on any domain; the page only ever receives the final
// assertion token. Decentralization stance: the accounts list is exactly this
// deployment's OWN switcher roster (resolveRoster — the anti-fixation
// ownership gate applies unchanged), never a central registry; sessions on
// other environments surface through the federated hints layer on
// first-party surfaces instead, because only sessions this roster owns can be
// redeemed here.

// Browsers stamp Sec-Fetch-Dest: webidentity on every FedCM fetch. Requiring
// it keeps ordinary page JS (which cannot set Sec-Fetch-*) from reading these
// credentialed endpoints cross-site.
export const isFedcmFetch = (request: Request): boolean =>
	(request.headers.get('Sec-Fetch-Dest') || '').toLowerCase() === 'webidentity';

// The FedCM client_id Thingtime deployments use for themselves (full-session
// handoff); registered apps use their ttapp_… clientId (app-scoped token).
export const FEDCM_SELF_CLIENT_ID = 'thingtime-self';

export type FedcmAccount = {
	id: string;
	name: string;
	email: string;
	picture?: string;
};

export const toFedcmAccount = (account: RosterAccount): FedcmAccount => ({
	id: account.userId,
	name: account.user.displayName || account.user.username,
	// the sheet is the user's own browser UI — the RP sees nothing until the
	// user consents to an assertion
	email: account.user.email || `@${account.user.username}`,
	...(account.user.avatarUrl ? { picture: account.user.avatarUrl } : {})
});

export type FedcmRoster = { accounts: RosterAccount[]; setCookies: string[] };

// The signed-in accounts this deployment can vouch for AND redeem: the
// browser's own roster, freshly resolved (dead sessions pruned exactly like
// the account switcher's read path).
export const fedcmRoster = async (request: Request): Promise<FedcmRoster> => {
	const roster = await resolveRoster(request);
	return { accounts: roster.accounts, setCookies: [] };
};

export const fedcmConfigFor = (request: Request) => {
	const origin = resolvePublicOrigin(request).origin;
	return {
		accounts_endpoint: `${origin}/api/v1/fedcm/accounts`,
		client_metadata_endpoint: `${origin}/api/v1/fedcm/client-metadata`,
		id_assertion_endpoint: `${origin}/api/v1/fedcm/assertion`,
		login_url: `${origin}/login`,
		branding: {
			name: 'Thingtime',
			background_color: '#16161a',
			color: '#ffffff'
		}
	};
};
