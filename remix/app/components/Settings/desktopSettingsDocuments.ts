import type { WebpageBlock } from '../Builder/webpageBlocks';

// Ordinary authored Builder blocks. Only binding names and presentation live
// here; native credentials and callbacks belong to the transient adapter.
const element = (id: string, tag: string, text = '', props: Record<string, unknown> = {}, children?: WebpageBlock[], css?: Record<string, string>): WebpageBlock =>
  ({ id, type: 'element', tag, text, props, ...(children ? { children } : {}), ...(css ? { css } : {}) } as unknown as WebpageBlock);
const condition = (id: string, arg: string, children: WebpageBlock[], equals: string | boolean = true): WebpageBlock =>
  ({ id, type: 'condition', condition: { arg, equals }, children } as unknown as WebpageBlock);
const repeat = (id: string, itemsPath: string, children: WebpageBlock[]): WebpageBlock =>
  ({ id, type: 'collection', props: { itemsPath, size: 'all', transparent: true, label: 'Items' }, children } as unknown as WebpageBlock);
const action = (operation: string, inputs: Record<string, string> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const button = (id: string, text: string, operation: string, props: Record<string, unknown> = {}) => element(id, 'button', text,
  { type: 'button', disabled: '{result.busy}', ...action(operation), ...props }, undefined,
  { padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', 'background-color': 'var(--tt-card, white)', color: 'inherit', cursor: 'pointer', 'white-space': 'normal' });
const paragraph = (id: string, text: string, props: Record<string, unknown> = {}) => element(id, 'p', text, props, undefined, { margin: '8px 0', 'font-size': '13px', 'line-height': '1.6', 'overflow-wrap': 'anywhere' });
const field = (id: string, label: string, props: Record<string, unknown> = {}) => element(`${id}-label`, 'label', '', { htmlFor: id }, [
  paragraph(`${id}-caption`, label), element(id, 'input', '', { id, name: id, disabled: '{result.busy}', autoComplete: 'off', ...props }, undefined,
    { width: '100%', 'min-width': '0', padding: '9px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', color: 'inherit', background: 'var(--tt-card, white)' })
]);
const section = (id: string, title: string, children: WebpageBlock[]) => element(id, 'fieldset', '', {}, [element(`${id}-title`, 'legend', title), ...children],
  { 'min-width': '0', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '10px', padding: '12px', margin: '0 0 14px' });
const row = (id: string, children: WebpageBlock[]) => element(id, 'div', '', {}, children, { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'align-items': 'center', margin: '8px 0' });

export const DESKTOP_SESSION_BLOCKS: WebpageBlock[] = [condition('session-present', 'result.sessionPresent', [section('desktop-session', 'Desktop session workspace', [
  paragraph('session-mode', 'Currently using: {result.workspaceMode}.'),
  paragraph('session-explanation', 'Recover an earlier desktop session by entering its exact API origin and local page URL. Thingtime reopens its cookies, local storage and IndexedDB in place, including saved views and layout. Your newer workspace is kept separately. Data from other local ports is not combined.'),
  condition('session-legacy', 'result.legacy', [paragraph('session-legacy-origins', 'Previous workspace: {result.legacyApiOrigin} · {result.legacyContentOrigin}')]),
  condition('session-unavailable', 'result.recoveryAvailable', [paragraph('session-unavailable-message', 'Session recovery is unavailable in local API mode and isolated development sessions.')], false),
  field('desktop-session-api-origin', 'Previous API origin', { type: 'url', placeholder: 'https://your-thingtime.example', disabled: '{result.recoveryDisabled}' }),
  field('desktop-session-content-origin', 'Previous local page URL', { type: 'url', placeholder: 'http://127.0.0.1:port', disabled: '{result.recoveryDisabled}' }),
  paragraph('session-exact-port', 'Use the exact port from the earlier app. The desktop confirmation shows both origins before restarting.'),
  row('session-actions', [button('recover-session', 'Recover previous workspace', 'session.recover', { disabled: '{result.recoveryDisabled}' }),
    condition('session-newer-available', 'result.legacy', [button('current-session', 'Use newer workspace', 'session.current', { disabled: '{result.recoveryDisabled}' })])])
])])];

export const DESKTOP_RUNTIME_BLOCKS: WebpageBlock[] = [condition('runtime-present', 'result.runtimePresent', [section('desktop-runtime', 'Local API and database', [
  paragraph('runtime-explanation', 'Run Thingtime and connect your ChatGPT plan on this computer. Local accounts and data are separate from your cloud account; enabling this does not copy cloud data.'),
  row('runtime-enabled-row', [element('desktop-local-api', 'input', '', { id: 'desktop-local-api', name: 'runtime-enabled', type: 'checkbox', checked: '{result.runtimeEnabled}', disabled: '{result.busy}', ...action('runtime.enabled') }), element('runtime-enabled-label', 'label', 'Use a local API', { htmlFor: 'desktop-local-api' })]),
  paragraph('runtime-current', 'Currently using: {result.runtimeMode}. Changes apply after restart. Local mode never falls back to the cloud.'),
  condition('runtime-options', 'result.runtimeEnabled', [
    element('database-mode-label', 'label', 'Database for the local API', { htmlFor: 'desktop-database-mode' }),
    element('desktop-database-mode', 'select', '', { id: 'desktop-database-mode', name: 'database-mode', value: '{result.databaseMode}', disabled: '{result.busy}', ...action('runtime.database-mode') }, [
      element('managed-option', 'option', 'MongoDB on this computer', { value: 'managed' }), element('external-option', 'option', 'Existing MongoDB connection', { value: 'external' })]),
    condition('runtime-managed', 'result.databaseMode', [paragraph('mongod-label', '{result.mongoLabel}'), row('mongod-actions', [button('choose-mongod', 'Choose mongod', 'runtime.choose-mongod'), element('download-mongod', 'a', 'Download MongoDB Community', { href: 'https://www.mongodb.com/try/download/community', target: '_blank', rel: 'noopener noreferrer' })]),
      paragraph('managed-explanation', 'Thingtime includes MongoDB Community Server for a new local setup. You can also choose an existing mongod executable. Thingtime manages an authenticated database in its own app data folder while the app runs. No system service is installed.')], 'managed'),
    condition('runtime-external', 'result.databaseMode', [field('desktop-mongo-uri', 'MongoDB connection URI', { type: 'password', placeholder: '{result.mongoPlaceholder}' }),
      paragraph('external-explanation', 'Stored using the system credential store. Use a database dedicated to this Thingtime installation with replica-set transactions enabled. Its accounts are managed by this local API.')], 'external'),
    field('desktop-api-port', 'Local API port', { type: 'number', min: 1024, max: 65535, value: '{result.apiPort}' }),
    condition('runtime-database-port', 'result.databaseMode', [field('desktop-db-port', 'Local database port', { type: 'number', min: 1024, max: 65535, value: '{result.databasePort}' })], 'managed')
  ]),
  condition('mongo-unsupported', 'result.mongoUnsupported', [paragraph('mongo-os-warning', 'The included MongoDB requires macOS 14 or later. Choose a compatible executable or an existing MongoDB connection on this Mac.', { role: 'alert' })]),
  condition('runtime-locked', 'result.encryptionAvailable', [paragraph('runtime-unlock', 'Unlock the system credential store to save local runtime settings.', { role: 'alert' })], false),
  condition('runtime-error', 'result.runtimeErrorPresent', [paragraph('runtime-error-message', '{result.runtimeError}', { role: 'alert' })]),
  row('runtime-save-actions', [button('save-runtime', 'Save runtime settings', 'runtime.save', { disabled: '{result.saveRuntimeDisabled}' }),
    condition('runtime-restart', 'result.restartRequired', [button('restart-runtime', 'Restart Thingtime', 'runtime.restart')])])
])])];

export const DESKTOP_ENDPOINT_BLOCKS: WebpageBlock[] = [section('desktop-endpoints', 'API endpoint', [
  paragraph('endpoint-explanation', 'The packaged interface stays on this computer. Account data and Thingtime Node use this API endpoint; pairing stays separate per endpoint.'),
  condition('endpoint-local', 'result.localActive', [paragraph('endpoint-local-notice', 'Turn off the local API and restart to change the selected remote API.')]),
  element('endpoint-select', 'select', '', { 'aria-label': 'API endpoint', value: '{result.selectedEndpointId}', disabled: '{result.endpointDisabled}', ...action('endpoint.select') }, [
    repeat('endpoint-options', 'result.endpoints', [element('endpoint-option', 'option', '{item.label}', { value: '{item.id}' })])]),
  paragraph('endpoint-url', '{result.selectedEndpointUrl}'),
  paragraph('endpoint-compatibility', '{result.compatibilityMessage}'),
  button('endpoint-check', 'Check now', 'endpoint.check'),
  repeat('custom-endpoints', 'result.customEndpoints', [row('custom-endpoint-row', [paragraph('custom-endpoint-name', '{item.label} · {item.url}'),
    button('remove-endpoint', 'Remove', 'endpoint.remove', { ...action('endpoint.remove', { id: '{item.id}' }), disabled: '{item.disabled}' })])]),
  field('endpoint-name', 'Endpoint name', { placeholder: 'Endpoint name' }),
  field('endpoint-url-input', 'Endpoint URL', { type: 'url', placeholder: 'https://your-thingtime.example/' }),
  button('add-endpoint', 'Add endpoint', 'endpoint.add')
])];
export const DESKTOP_NOTICE_BLOCKS: WebpageBlock[] = [condition('desktop-notice', 'result.noticePresent', [paragraph('desktop-notice-message', '{result.notice}', { role: 'status' })])];
export const DESKTOP_CONNECTION_BLOCKS = [...DESKTOP_SESSION_BLOCKS, ...DESKTOP_RUNTIME_BLOCKS, ...DESKTOP_ENDPOINT_BLOCKS, ...DESKTOP_NOTICE_BLOCKS];

export const DESKTOP_RECOVERY_BLOCKS = [element("desktop-recovery", "details", "", {}, [
  element("desktop-recovery-title", "summary", "API and local runtime settings", {}, undefined, { cursor: "pointer", "font-weight": "600" }),
  paragraph("desktop-recovery-description", "Choose a reachable API, or run Thingtime on this computer. These settings do not need a cloud session."),
  ...DESKTOP_CONNECTION_BLOCKS
], { margin: "24px 0 0", padding: "16px", border: "1px solid var(--tt-border, #ddd)", "border-radius": "10px" })];
