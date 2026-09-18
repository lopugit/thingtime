// One reference for /docs/builder, docs search, and Lopu's authoring prompt.
export const builderSaveExample = {
	name: 'Save address',
	actionKey: 'save-address',
	inputs: [
		{ name: 'address', type: 'string', required: true },
		{ name: 'notes', type: 'text' },
		{ name: 'photo', type: 'string' },
		{ name: 'photoAttachmentId', type: 'string' }
	],
	capabilities: [{ capability: 'things.create', schemas: ['Address'] }],
	steps: [
		{
			op: 'things.create',
			schema: 'Address',
			values: { address: '$input.address', notes: '$input.notes', photo: '$input.photo', photoAttachmentId: '$input.photoAttachmentId' }
		},
		{ op: 'return', value: { id: '$step.1.id', message: 'Address saved' } }
	]
};
export const builderFormExample = {
	name: 'Address form',
	componentKey: 'address-form',
	render: {
		tag: 'fieldset',
		children: [
			{ tag: 'label', children: ['Street address', { tag: 'input', props: { name: 'address', required: true, maxLength: 500 } }] },
			{ tag: 'label', children: ['Notes', { tag: 'textarea', props: { name: 'notes' } }] },
			{ tag: 'tt-upload', props: { name: 'photo', imageOnly: true, title: 'Property photo' } },
			{ tag: 'button', props: { type: 'button' }, ttAction: 'save-address', children: ['Save address'] }
		]
	}
};
export const builderLookupExample = {
	name: 'Look up address',
	actionKey: 'lookup-address',
	inputs: [{ name: 'address', type: 'string', required: true, maxLength: 500 }],
	capabilities: [{ capability: 'lookup', providers: ['google-geocoding'] }],
	steps: [
		{ op: 'lookup', provider: 'google-geocoding', credentialId: 'YOUR_VAULT_ENTRY_ID', query: '$input.address' },
		{ op: 'return', value: '$step.1' }
	]
};
export const builderGuideSections = [
	{
		id: 'start',
		title: 'Build a working component',
		paragraphs: [
			'A page arranges blocks. A component describes the interface as JSON. A schema defines saved data, and an action reads or writes that data through the Thingtime API. Component arguments configure the interface; typing into an input does not save a Thing.',
			'Create the Address schema first, then the save action, then the component, then a webpage component block. Keep each accumulating address as its own Data Thing. Use a stable record id for edits; never replace the whole address book with one growing array.',
			'Use View mode on an owned /p/:id page to run controls. Edit/layout mode and decorative previews are inert. Shared pages permit only authorized read-only actions; fork a shared app to get your own writable actions. Uploads require sign-in and upload approval.'
		],
		example: {
			name: 'Address',
			fields: [
				{ name: 'address', type: 'string', required: true },
				{ name: 'notes', type: 'string' },
				{ name: 'photo', type: 'string' },
				{ name: 'photoAttachmentId', type: 'string' }
			]
		}
	},
	{
		id: 'forms',
		title: 'Form inputs and saving',
		paragraphs: [
			'Use HTML input, select and textarea nodes with a name matching an action input descriptor. Put each independent form or editable row in a fieldset; its button collects only that group. Without a fieldset, the whole component is the group. Use one name per field, except radio groups.',
			'ttAction names an action you own. ttActionInputs supplies static values such as the record id; current named fields win. Text remains text, including phone numbers with leading zeros. Checkboxes send booleans, radios send the checked option. Declare number inputs as number in the action for server conversion.',
			'Explicit empty text clears a saved value instead of restoring a default. Missing inputs may use descriptor defaults. Disabled, password and raw file inputs are excluded. Required/min/max/maxLength constraints run before submission; server validation remains authoritative. Oversized input fails visibly rather than silently truncating.',
			'Pending uploads block saving until Use file finishes. Repeated clicks while a run is pending are ignored. Drafts stay in place on success or failure. A successful action refreshes bound lists. A network failure may have completed a write: read back before retrying a create, and inspect the action run history.',
			'For edits declare an id input, pass ttActionInputs: { id: "{item.id}" }, and use { op: "things.update", id: "$input.id", values: { notes: "$input.notes" } } with things.update capability. Updates merge supplied fields; omit fields you are not editing.'
		],
		example: builderFormExample
	},
	{
		id: 'actions',
		title: 'Save and read Data Things',
		paragraphs: [
			'Create the schema before the action. The step schema is the exact schema name or id. Every field in values must match that schema. Actions create private Data Things and apply normal permissions, quotas and validation.',
			'Declare every collected field in inputs, including both photo and photoAttachmentId for an upload named photo. Unknown inputs are refused. Never claim success from a button click: wait for the run status to be ok and use the returned id to verify readback.',
			'A source binding loads data into result. For an address list, use a things.search action over Address and return { items: "$step.1" }; render ttEach with arg: "result.items". Component source is inherited by page blocks; an explicit block source overrides it. Refresh modes are load, manual, and bounded interval.',
			'Runtime last contains action, ok, result and error. Use {last.result.message} for confirmation and {last.error} for failures. Keep form controls outside conditional branches that disappear during source refresh so drafts stay mounted.'
		],
		example: builderSaveExample
	},
	{
		id: 'uploads',
		title: 'Real file uploads',
		paragraphs: [
			'Use { tag: "tt-upload", props: { name: "photo", imageOnly: true, title: "Property photo" } }, or Chakra Upload. An input type=file or styled dropzone alone does not upload anything. The shared native uploader supports selection, preview, progress, replacement, removal and retry; Use URL instead is optional.',
			'After upload processing finishes, choose Use file. This commits a private attachment-backed file to your account. The form receives photo (content URL) and photoAttachmentId (attachment id). Persist both through your action. The file stays private; storing its URL does not grant another viewer access.',
			'For editing an existing file field, pass value and attachmentId props from the saved record. These initialize the control; key repeated rows by stable record id. Upload names use a letter followed by letters, digits or underscores, up to 28 characters, leaving room for AttachmentId.',
			'Use file retries retain the same upload identity. A selected replacement blocks submission until committed. Clear field removes the form value but retains the saved private file in your account. Disabled controls do not submit a value. Storage limits, moderation, approval and account ownership still apply.',
			'If an upload is unavailable, check View mode, sign-in, ownership/shared mode, and upload approval. Do not bump a component version to fix runtime wiring. Test both its dedicated component page and the embedded /p/:id page.'
		]
	},
	{
		id: 'lookups',
		title: 'Address and external lookups',
		paragraphs: [
			'A lookup action sends entered text to a registered external provider. Google Maps geocoding is the first adapter. Put the address input and a Look up button with ttAction: "lookup-address" in their own fieldset; show last.result.items and last.result.attribution after the response. The button initiates the request; typing alone makes no requests.',
			'Create a secret in your Vault containing your Google Maps Geocoding API key. Replace YOUR_VAULT_ENTRY_ID below with that entry id, never the key. Enable the Geocoding API and billing in your Google Cloud project, and restrict the key appropriately for server requests. Only an action you own can use your Vault credential. Shared runs cannot make lookups.',
			'The provider registry fixes the HTTPS destination, accepted query and public result shape. Actions cannot choose arbitrary URLs, headers, redirects or raw secrets. Queries cap at 500 characters, responses at 128 KiB and five results, and requests at eight seconds within the action deadline. No automatic retry or per-keystroke billing. Missing setup, quota failures and timeouts produce an error; no matches produce an empty items array.',
			'Google Maps results include address, placeId, latitude and longitude. Display Google Maps attribution. Follow provider display and storage rules before saving provider-derived data; prefer saving the user-entered address and place id. Built-in run history and source caches omit lookup results. Further providers need a registered adapter, capability coverage, bounded output, credential handling and tests.',
			'Lopu chat tools fetch_url/http_request and the JavaScript lopu client are separate interfaces. Authored JSON cannot execute JavaScript, fetch, onChange or arbitrary event handlers. Use declarative actions for component behavior.'
		],
		example: builderLookupExample
	},
	{
		id: 'troubleshooting',
		title: 'Test and troubleshoot',
		paragraphs: [
			'Upload placeholder: open View mode on an owned page. Sign-in message: log into the account owning the action. No action you own matches: create or fork the action into that account and check its exact actionKey.',
			'Unknown input: match every field name to an action descriptor, and group independent buttons in separate fieldsets. Required input: fill it or make the descriptor optional. A cleared field reappears: ensure the action writes the explicit empty value instead of using an expression that substitutes a default.',
			'Saved data missing: inspect the run, read the returned Thing id, check the schema name and private ownership, then reload. A list must have a source action; a static placeholder is not data binding. Test a failed save, a fast double click and an account switch while a request is pending.',
			'Verify upload → Use file → form save → readback → reload. Test create and edit, blank optional text, false checkboxes, leading-zero text and two independent fieldsets. Check desktop/mobile, opened upload options, scrolling and long labels.'
		]
	}
];
export const builderAuthoringGuide = () =>
	builderGuideSections
		.map(
			(section) =>
				`### ${section.title} (/docs/builder/${section.id})\n${section.paragraphs.join('\n')}${
					section.example ? '\n' + JSON.stringify(section.example) : ''
				}`
		)
		.join('\n\n');
