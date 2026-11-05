import type { WebpageBlock } from '../Builder/webpageBlocks';

const element = (id: string, tag: string, text = '', props: Record<string, unknown> = {}, children?: WebpageBlock[], css?: Record<string, string>): WebpageBlock =>
	({ id, type: 'element', tag, text, props, children, css } as unknown as WebpageBlock);
const show = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock =>
	({ id, type: 'condition', condition: { arg: `result.${arg}`, equals: true }, children } as WebpageBlock);
const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const line = (id: string, text: string, props: Record<string, unknown> = {}) =>
	element(id, 'p', text, props, undefined, { 'font-size': '13px', 'line-height': '1.55', margin: '4px 0', 'overflow-wrap': 'anywhere' });
const heading = (id: string, title: string) => element(id, 'h2', title, {}, undefined, { 'font-weight': '650', 'font-size': '16px', margin: '0 0 4px' });
const row = (id: string, children: WebpageBlock[]) =>
	element(id, 'div', '', {}, children, { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'align-items': 'center', margin: '8px 0 0' });
const stack = (id: string, children: WebpageBlock[]) =>
	element(id, 'fieldset', '', {}, children, { display: 'grid', gap: '8px', 'min-width': '0', padding: '14px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px' });
const button = (id: string, text: string, operation: string, primary = false, disabled = '{result.busy}') =>
	element(id, 'button', text, { type: 'button', disabled, ...action(operation) }, undefined, {
		'min-height': '44px', padding: '8px 13px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px',
		background: primary ? 'var(--tt-ink, #16161a)' : 'var(--tt-card, white)',
		color: primary ? 'var(--tt-card, white)' : 'inherit', cursor: 'pointer', 'font-size': '13px', 'font-weight': '600'
	});
const inputCss = { width: '100%', 'min-width': '0', 'min-height': '44px', padding: '8px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', color: 'inherit', background: 'var(--tt-card, white)' };
const label = (id: string, caption: string, control: WebpageBlock) =>
	element(`${id}-label`, 'label', '', {}, [line(`${id}-caption`, caption), control]);
const input = (id: string, caption: string, props: Record<string, unknown>) =>
	label(id, caption, element(id, 'input', '', { name: id, 'aria-label': caption, autoComplete: 'off', spellCheck: false, disabled: '{result.busy}', ...props }, undefined, inputCss));
const option = (id: string, title: string, value: string) => element(id, 'option', title, { value });
const progress = (id: string) => show(id, 'busy', [
	element(`${id}-indicator`, 'progress', '', { 'aria-label': 'Credential operation in progress' }, undefined, { width: '54px', height: '5px', 'accent-color': 'currentColor' })
]);
const feedback = (id: string) => [
	show(`${id}-error`, 'hasError', [line(`${id}-error-text`, '{result.error}', { role: 'alert' })]),
	show(`${id}-success`, 'hasNotice', [line(`${id}-success-text`, '{result.notice}', { role: 'status' })])
];

// Each field, label, button and metadata line is a separate Builder block.
// The only authored bindings are transient operation names and safe metadata.
export const credentialImportBlocks = [stack('credential-import-form', [
	heading('credential-import-heading', 'Import provider credentials'),
	line('credential-import-intro', 'Choose a provider export or token and review its destination before storing it in the encrypted integration vault.'),
	line('credential-import-authority', '{result.origin} · {result.environment}'),
	show('credential-import-unavailable', 'unavailable', [line('credential-import-unavailable-text', '{result.unavailableMessage}')]),
	show('credential-import-entry', 'editingEntry', [
		label('import-format', 'Credential format', element('import-format', 'select', '', {
			name: 'import-format', 'aria-label': 'Credential format', value: '{result.format}', disabled: '{result.busy}', ...action('import.format')
		}, [
			option('import-google', 'Google OAuth client JSON', 'google-oauth'),
			option('import-json', 'Provider JSON', 'json'),
			option('import-text', 'Provider text token', 'text')
		], inputCss)),
		show('import-google-details', 'google', [
			line('import-google-vault-label', 'Vault label: connections-google-oauth'),
			line('import-google-callback', 'Required Google callback: {result.callbackUrl}')
		]),
		show('import-generic-details', 'generic', [input('import-label', 'Vault label', { type: 'text', value: '{result.label}', ...action('import.label') })]),
		show('import-existing', 'hasExisting', [
			line('import-existing-text', 'This label is already in use. Confirm replacement of revision {result.existingRevision}.'),
			label('import-replace', 'Replace the existing vault credential', element('import-replace', 'input', '', {
				type: 'checkbox', checked: '{result.replace}', disabled: '{result.replaceDisabled}', 'aria-label': 'Replace the existing vault credential', ...action('import.replace')
			}))
		]),
		show('import-file', 'fileMode', [
			input('credential-file', 'Choose credential file', { type: 'file', accept: '{result.accept}', ...action('import.file') }),
			show('import-file-picked', 'hasFile', [line('import-file-size', 'File selected · {result.fileSize} bytes', { role: 'status' })]),
			button('import-switch-paste', 'Paste a value instead', 'import.paste-mode')
		]),
		show('import-paste', 'pasteMode', [
			input('credential-paste', 'Paste credential value', { type: 'password', autoComplete: 'new-password' }),
			line('credential-paste-help', 'Use a file when a text credential contains line breaks.'),
			button('import-switch-file', 'Choose a file instead', 'import.file-mode')
		]),
		row('import-review-controls', [button('import-review', 'Review import', 'import.review', true), progress('import-reading')])
	]),
	show('import-review-panel', 'reviewing', [
		heading('import-review-title', 'Review vault destination'),
		line('import-review-format', '{result.reviewFormat}'),
		line('import-review-label', 'Vault label: {result.reviewLabel}'),
		show('import-review-google', 'google', [line('import-review-callback', 'Callback: {result.callbackUrl}')]),
		line('import-review-operation', '{result.reviewOperation} · {result.reviewSize} bytes'),
		show('import-review-existing', 'reviewReplacing', [line('import-review-id', 'Credential ID: {result.reviewCredentialId}')]),
		row('import-submit-controls', [button('import-submit', 'Save encrypted credential', 'import.save', true), button('import-discard', 'Discard', 'import.discard'), progress('import-saving')])
	]),
	...feedback('import')
])];

export const credentialHandoffBlocks = [stack('credential-handoff-review', [
	heading('handoff-heading', 'Credential handoff'),
	line('handoff-description', 'Review the request before allowing the sender to deliver a credential to this Thingtime vault.'),
	line('handoff-origin', 'Thingtime server: {result.origin}'),
	show('handoff-details', 'hasIntent', [
		line('handoff-request', 'Request: {result.requestId}'),
		line('handoff-account', 'Account: {result.account}'),
		line('handoff-vault', 'Destination: encrypted integration vault · {result.environment}'),
		line('handoff-format', 'Credential format: {result.format}'),
		line('handoff-label', 'Vault label: {result.label}'),
		show('handoff-google', 'google', [line('handoff-callback', 'Callback: {result.callbackUrl}')]),
		line('handoff-write', '{result.operation}'),
		line('handoff-expiry', 'Expires: {result.expiresAt}'),
		line('handoff-state', '{result.status}', { role: 'status' }),
		show('handoff-receipt', 'hasReceipt', [
			line('handoff-credential-id', 'Credential ID: {result.credentialId}'),
			line('handoff-receipt-updated-at', 'Saved revision: {result.credentialUpdatedAt}')
		])
	]),
	row('handoff-actions', [
		show('handoff-can-approve', 'canApprove', [button('handoff-approve', 'Approve this handoff', 'handoff.approve', true)]),
		show('handoff-can-revoke', 'canRevoke', [button('handoff-revoke', 'Cancel handoff', 'handoff.revoke')]),
		show('handoff-can-refresh', 'canRefresh', [button('handoff-refresh', 'Refresh status', 'handoff.inspect', false, '{result.refreshDisabled}')]),
		progress('handoff-progress')
	]),
	...feedback('handoff')
])];
