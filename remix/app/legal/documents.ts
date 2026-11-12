import legacy from './legacy.json';

export type LegalDocument = {
	slug: string;
	title: string;
	version: string;
	effectiveDate: string;
	status: 'current' | 'archived';
	scope: string;
	summary: string;
	sections: { heading: string; paragraphs: string[] }[];
};

const contact =
	'For privacy questions, access, correction, export or deletion requests, or complaints, email contact@thingtime.com. We may ask for information needed to verify your identity. Explain your request and the account concerned; do not send passwords. We will respond within a reasonable time and explain any limits or refusal. If a privacy complaint remains unresolved, you can contact the Office of the Australian Information Commissioner at https://www.oaic.gov.au or your local privacy regulator.';
const privacySections: LegalDocument['sections'] = [
	{
		heading: 'Who we are and what this covers',
		paragraphs: [
			'Thingtime is operated by Nikolaj Samuel Frey in Australia (Thingtime, we, us). This policy explains how we handle personal information when you use thingtime.com and the Thingtime apps, including Apple TV. Independently operated deployments and third-party services have their own operators and privacy practices.'
		]
	},
	{
		heading: 'Information we collect',
		paragraphs: [
			'We receive the information you provide: account and sign-in details, email address, username, profile information, preferences, support requests, and content you create, upload or share. Content can include Things, pages, posts, messages, reactions, files, images, audio, recordings, transcripts and AI conversations. The information involved depends on the features you use.',
			'We process technical information needed to run and protect the service, such as IP addresses, browser and device information, request and error logs, session identifiers, connected-device identifiers and notification tokens. Website analytics help us understand page visits and use. Payment or subscription features may involve transaction, entitlement and billing records; the payment provider handles the payment details entered in its checkout.'
		]
	},
	{
		heading: 'How we use information',
		paragraphs: [
			'We use information to provide accounts, save and synchronise content, deliver messages and notifications, perform actions you request, personalise settings, provide support, understand service use, maintain reliability, detect abuse, moderate content and meet legal obligations. If you do not provide information needed for a feature, that feature may not work.'
		]
	},
	{
		heading: 'Sharing and service providers',
		paragraphs: [
			'Information is shared with people you choose to share with and according to the visibility and permissions of your content. Public profiles and public content can be viewed, copied or indexed by others. Recipients may retain their own copies. Private content is still processed by Thingtime to provide the service; private visibility is not a promise of end-to-end encryption.',
			'We use service providers for hosting, storage, databases, email delivery, analytics, payments, AI processing and security. For example, the website uses Vercel hosting and analytics, and configured features can use Amazon Web Services and AI providers such as OpenAI or Anthropic. The provider used depends on the feature and your connections. We share the information needed to perform those services. Connected apps receive information within the permissions you authorise. We may also disclose information where required by law, to protect rights and safety, or in a business transfer subject to applicable privacy obligations.'
		]
	},
	{
		heading: 'AI, recordings and connected services',
		paragraphs: [
			'When you use AI or transcription features, your prompts, messages, recordings, attachments and relevant context may be sent to the selected or configured AI provider to produce a response or carry out your request. Content submitted to moderation can also be processed by a moderation provider. Provider processing and retention are subject to the applicable service arrangements and provider policies; do not submit information you are not authorised to share.',
			'Connecting another service or device can allow Thingtime to receive the data you select and send data or actions to that service. Review the connection permissions and disconnect services you no longer use. Obtain any consent needed before recording or uploading information about other people.'
		]
	},
	{
		heading: 'Cookies, local storage and device permissions',
		paragraphs: [
			'We use cookies and local device storage for sign-in sessions, account switching, preferences, cached content and continuity. You can clear browser or app storage, but this may sign you out or remove local-only data. Device features such as microphone, camera, photos, notifications or location are available only where supported and subject to the device permissions you grant. You can change permissions in device settings.'
		]
	},
	{
		heading: 'Retention and security',
		paragraphs: [
			'We keep account information and saved content while needed to provide the service and fulfil the purposes described here. Retention varies with the kind of information, your actions, security needs and legal obligations; there is no single retention period for all data. Deleting content or requesting account deletion may not immediately remove backups, required transaction records, security logs or copies held by recipients.',
			'We use safeguards such as access controls, authenticated sessions and protected credential storage. No system is completely secure. Keep your credentials safe, review sharing settings and contact us if you suspect unauthorised access.'
		]
	},
	{
		heading: 'International processing and your choices',
		paragraphs: [
			'Thingtime and its providers may process information outside your country, including Australia and the United States. Other locations depend on the connected provider and service you use; privacy protections may differ. Contact us for information about the providers relevant to your request.',
			'You can edit available account and profile fields, change content visibility, remove content using the available controls and revoke connected services or device permissions. You may have additional rights under applicable law, including access, correction, deletion, portability, objection or restriction. Contact us to exercise those rights or request account deletion.'
		]
	},
	{
		heading: 'Children and young people',
		paragraphs: [
			'Do not provide children’s personal information unless you are authorised to do so and the use is permitted by applicable law. If you believe a child has provided information without required permission, contact us so we can investigate and take appropriate action. Parents and guardians should supervise use where required.'
		]
	},
	{ heading: 'Contact and complaints', paragraphs: [contact] },
	{
		heading: 'Policy changes',
		paragraphs: [
			'We publish dated versions in the legal directory at https://thingtime.com/legal. The current version describes our current practices; archived versions are historical records. We will communicate material changes where required and obtain consent where the law requires it.'
		]
	}
];

export const legalDocuments: readonly LegalDocument[] = [
	{
		slug: 'privacy-policy',
		title: 'Privacy Policy',
		version: '1.0.0',
		effectiveDate: '2026-09-16',
		status: 'current',
		scope: 'Thingtime website and apps',
		summary: 'Account, content, device and service data across Thingtime.',
		sections: privacySections
	},
	{
		slug: 'apple-tv-privacy-policy',
		title: 'Apple TV Privacy Policy',
		version: '1.0.0',
		effectiveDate: '2026-09-16',
		status: 'current',
		scope: 'Thingtime on Apple TV (tvOS)',
		summary: 'Standalone privacy text for Thingtime on Apple TV and App Store Connect.',
		sections: [
			{
				heading: 'Thingtime on Apple TV',
				paragraphs: [
					'This is the privacy policy for the Thingtime tvOS app, not Apple’s own Apple TV service. On a shared television, people with access to the device may see the account and content displayed. Sign out when you finish using a shared device. Features and permissions vary by platform; a feature described below applies only when available and used.'
				]
			},
			...privacySections
		]
	},
	{
		slug: 'terms-of-service',
		title: 'Terms of Service',
		version: '1.0.0',
		effectiveDate: '2026-09-16',
		status: 'current',
		scope: 'Thingtime website and apps',
		summary: 'Using Thingtime, your content, acceptable use and your rights.',
		sections: [
			{
				heading: 'About these terms',
				paragraphs: [
					'These terms apply to the Thingtime website and apps operated by Nikolaj Samuel Frey in Australia. By using Thingtime, you agree to these terms. If you do not agree, do not use the service. Separate terms may apply to third-party services, independently operated deployments and merchandise purchases. The Privacy Policy at https://thingtime.com/pages/privacy-policy explains our information handling.'
				]
			},
			{
				heading: 'Eligibility and accounts',
				paragraphs: [
					'You must be legally able to use the service and agree to these terms, with a parent or guardian’s involvement where required by law. If you use Thingtime for an organisation, you must have authority to act for it. Provide accurate account information, protect your credentials and notify us of suspected unauthorised access. You are responsible for your use of the service.'
				]
			},
			{
				heading: 'Your content and permissions',
				paragraphs: [
					'You retain your rights in content you provide. You grant Thingtime permission to host, store, reproduce, process and display that content as needed to operate the service, follow your instructions and apply your sharing choices. You must have the rights and permissions needed to upload, share or record it. This permission does not transfer ownership of your content.',
					'Choose visibility carefully. Other users may retain content you share with them, and public material may be copied or indexed. Removing content does not remove copies others already hold. Keep your own backups of important information.'
				]
			},
			{
				heading: 'Acceptable use',
				paragraphs: [
					'Do not use Thingtime for unlawful activity, harassment, threats, child sexual exploitation, non-consensual intimate content, fraud, spam or infringement of others’ rights. Do not access accounts or private content without permission, bypass security or usage limits, distribute malicious software, or disrupt the service. Report abuse or rights violations to contact@thingtime.com with enough information for us to investigate.'
				]
			},
			{
				heading: 'AI and external services',
				paragraphs: [
					'AI output can be inaccurate or incomplete. Review outputs and actions before relying on them, especially for consequential decisions. AI responses are not a substitute for qualified professional advice. You remain responsible for instructions you give and actions you authorise.',
					'Connected services, external links and third-party apps have their own terms and privacy practices. Availability and functionality can change. Only connect accounts you are authorised to use.'
				]
			},
			{
				heading: 'Payments and subscriptions',
				paragraphs: [
					'Where a paid feature is offered, its price, billing interval, renewal and cancellation conditions are shown before purchase. Only purchase if you agree to those conditions. Manage purchases made through Apple using your Apple account and Apple’s applicable billing and refund processes. Mandatory consumer rights continue to apply. No paid feature or subscription is created simply by reading these terms.'
				]
			},
			{
				heading: 'Availability, moderation and ending use',
				paragraphs: [
					'We may update features, impose reasonable limits, or remove content and restrict access to address abuse, security risks, legal requirements or breaches of these terms. Where practicable and appropriate, we will explain a restriction and you may contact us to ask for review. Urgent safety or legal circumstances may require action without advance notice.',
					'You may stop using Thingtime at any time. Use available content controls or contact contact@thingtime.com to request account deletion. The Privacy Policy explains retention limitations. Ending use does not cancel an external subscription automatically; use the relevant billing provider’s cancellation controls.'
				]
			},
			{
				heading: 'Service rights and consumer protections',
				paragraphs: [
					'Thingtime and its licensors retain their rights in the service, subject to any applicable open-source licences. You may use the service in accordance with these terms and applicable law.',
					'We aim to provide a useful and reliable service, but do not promise uninterrupted access or error-free content. To the extent permitted by law, the service is provided as available. Nothing in these terms excludes, restricts or modifies consumer guarantees or other rights and remedies that cannot lawfully be excluded, including under the Australian Consumer Law.'
				]
			},
			{
				heading: 'Changes, disputes and contact',
				paragraphs: [
					'We publish dated versions at https://thingtime.com/legal and will give notice of material changes where required. Changes apply prospectively and do not remove accrued rights. If you do not agree to changed terms, stop using the service.',
					'These terms are governed by the laws of Victoria, Australia, subject to any mandatory protections and jurisdiction rights that apply where you live. Please first contact contact@thingtime.com about a dispute so we can try to resolve it. If a provision is unenforceable, the remaining terms continue to apply to the extent lawful.'
				]
			}
		]
	},
	{
		slug: 'privacy-policy',
		title: 'Privacy Policy',
		version: '2025-01-01',
		effectiveDate: '2025-01-01',
		status: 'archived',
		scope: 'Historical website notice',
		summary: 'Superseded notice. Its no-data-collection statement does not describe the current service.',
		sections: [{ heading: 'Original notice (historical)', paragraphs: [legacy.privacy] }]
	},
	{
		slug: 'merchandise-terms',
		title: 'Merchandise End User Terms',
		version: '2025-02-21',
		effectiveDate: '2025-02-21',
		status: 'archived',
		scope: 'Historical merchandise shop terms',
		summary: 'Archived merchandise terms, not the terms for the Thingtime app.',
		sections: [{ heading: 'Original terms (historical)', paragraphs: [legacy.terms] }]
	}
];

export const resolveLegalDocument = (slug: string, version?: string) =>
	legalDocuments.find((doc) => doc.slug === slug && (version ? doc.version === version : doc.status === 'current'));
export const legalDocumentPath = (doc: LegalDocument, pinned = false) =>
	`/pages/${doc.slug}${pinned || doc.status === 'archived' ? `/${doc.version}` : ''}`;
export const legalDocumentText = (doc: LegalDocument) =>
	[
		`Thingtime — ${doc.title}`,
		`Version: ${doc.version}`,
		`Effective date: ${doc.effectiveDate}`,
		`Scope: ${doc.scope}`,
		...(doc.status === 'archived' ? ['ARCHIVED — historical text, not the current policy.', doc.summary] : []),
		...doc.sections.flatMap((section) => [section.heading, ...section.paragraphs])
	].join('\n\n');
