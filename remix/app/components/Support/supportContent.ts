export const SUPPORT_PATH = '/support';
export const SUPPORT_CAMPAIGN_URL = 'https://www.gofundme.com/f/thingtime';
export const SUPPORT_EMAIL = 'connect@thingtime.com';

export type SupportInquiryKind = 'setup' | 'sponsorship';

export const SUPPORT_INQUIRIES = {
	setup: {
		label: 'Paid setup & workflow help',
		subject: 'Thingtime setup — quote request',
		body: 'Hi Thingtime,\n\nI would like a quote for help setting up Thingtime or building a workflow.\n\nWhat I want to organise or build:\n\nWho will use it:\n\nPreferred timeframe:\n\nBudget and currency (optional):\n\nPlease let me know what is possible, your availability, and the proposed scope and price before we agree to any work.\n\nThanks!'
	},
	sponsorship: {
		label: 'Business & infrastructure sponsorship',
		subject: 'Thingtime sponsorship — inquiry',
		body: 'Hi Thingtime,\n\nI would like to discuss supporting Thingtime.\n\nMy business or organisation:\n\nSupport I can offer (funding, infrastructure, or service credits):\n\nProposed amount and currency, or service details:\n\nPreferred timing or duration:\n\nAny recognition or other terms I would like to discuss:\n\nPlease get in touch to agree the details before any commitment.\n\nThanks!'
	}
} as const;

export const supportMailto = (subject: string, body: string) =>
	`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
