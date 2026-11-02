import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { PasswordBrandMark } from './PasswordBrandMark';
import { BROWSER_PROVIDER_BLOCKS, migrateBrowserProviderBranding } from './browserProviderBlocks';
import { browserProviderVault, browserProviderFailure, ensureBrowserProvider, loadProviderChoices, providerRp, runProviderCeremony, validateProviderRequest, type BrowserProviderAttempt, type ProviderChoice, type ProviderRequest } from '~/passwords/browserProviderCeremony';

const detailOf = (event: Event) => { const detail = (event as CustomEvent).detail; return typeof detail === 'string' ? JSON.parse(detail) : detail; };
const emit = (name: string, detail: Record<string, unknown>) => document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify({ version: 1, ...detail }) }));

export function BrowserPasswordProvider() {
  const user = useCurrentUser();
  return <Box maxW="640px" mx="auto" px={{ base: 4, md: 6 }} pt="calc(var(--thingtime-safe-area-top, 0px) + 32px)" pb={8}>
    {user && !user.temporary ? <ProviderSession key={user.id} ownerId={user.id} /> : <>
      <Box display="flex" alignItems="center" gap={3}><PasswordBrandMark /><Text as="h1" fontSize="2xl" fontWeight={600}>Sign in to use your Thingtime passkeys</Text></Box>
      <Text my={4}>Sign in to your account, then restart the passkey request on the website.</Text>
      <Link to="/login">Sign in to Thingtime</Link>
    </>}
  </Box>;
}

function ProviderSession({ ownerId }: { ownerId: string }) {
  const [request, setRequest] = React.useState<ProviderRequest | null>(null);
  const [choices, setChoices] = React.useState<ProviderChoice[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState('');
  const [finished, setFinished] = React.useState('');
  const [excluded, setExcluded] = React.useState(false);
  const live = React.useRef<{ request: ProviderRequest; controller: AbortController; attempt: BrowserProviderAttempt; busy: boolean; excluded: boolean } | null>(null);
  const fieldRoot = React.useRef<HTMLDivElement>(null);
  const vault = React.useMemo(() => browserProviderVault(ownerId), [ownerId]);
  const clearPassword = () => { fieldRoot.current?.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input => { input.value = ''; }); };
  const finish = React.useCallback((result: Record<string, unknown>, message: string) => {
    const operation = live.current;
    if (!operation) return;
    live.current = null;
    operation.controller.abort();
    operation.attempt = {};
    clearPassword();
    setBusy(false); setExcluded(false); setChoices([]); setRequest(null); setFinished(message);
    emit('thingtime:password-provider-response', { id: operation.request.id, ...result });
  }, []);
  const refresh = React.useCallback(async () => {
    const operation = live.current;
    if (!operation || operation.busy || operation.excluded) return;
    operation.busy = true; setBusy(true); setError('');
    try {
      await ensureBrowserProvider(operation.controller.signal);
      const values = await loadProviderChoices(operation.request, vault, operation.controller.signal);
      if (live.current !== operation) return;
      setChoices(values); setLoaded(true);
    } catch {
      if (live.current === operation) setError('Saved passkeys could not be loaded. Check your connection and refresh.');
    } finally {
      operation.busy = false;
      if (live.current === operation) setBusy(false);
    }
  }, [vault]);
  React.useEffect(() => {
    const ready = () => emit('thingtime:password-provider-ready', {});
    const receive = (event: Event) => {
      let input: ProviderRequest | undefined;
      try {
        input = detailOf(event);
        const incoming = validateProviderRequest(input);
        if (live.current?.request.id === incoming.id) return;
        if (live.current) return; // A second request cannot replace current approval.
        live.current = { request: incoming, controller: new AbortController(), attempt: {}, busy: false, excluded: false };
        setRequest(incoming); setExcluded(false); setLoaded(false); setFinished(''); setError('');
        void refresh();
      } catch {
        // Correlate a refused request without retaining its unvalidated options.
        // The extension independently checks this document and request identity.
        if (!live.current && input?.version === 1 && typeof input.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.id))
          emit('thingtime:password-provider-response', { id: input.id, error: { name: 'NotSupportedError', message: 'This passkey request is unsupported. Choose another provider.' } });
        setError('This passkey request is unsupported. Use your browser’s other provider.');
      }
    };
    const cancel = (event: Event) => {
      try { if (detailOf(event)?.id === live.current?.request.id) finish({ error: { name: 'AbortError', message: 'The website cancelled its passkey request.' } }, 'Request cancelled.'); } catch { /* Invalid event. */ }
    };
    const hide = () => { clearPassword(); };
    const pagehide = () => finish({ error: { name: 'AbortError', message: 'The passkey page was closed.' } }, 'Request cancelled.');
    document.addEventListener('thingtime:password-provider-request', receive);
    document.addEventListener('thingtime:password-provider-cancel', cancel);
    document.addEventListener('thingtime:password-provider-init', ready);
    window.addEventListener('blur', hide);
    window.addEventListener('pagehide', pagehide);
    ready();
    return () => {
      document.removeEventListener('thingtime:password-provider-request', receive);
      document.removeEventListener('thingtime:password-provider-cancel', cancel);
      document.removeEventListener('thingtime:password-provider-init', ready);
      window.removeEventListener('blur', hide); window.removeEventListener('pagehide', pagehide);
      if (live.current) { const current = live.current; live.current = null; current.controller.abort(); current.attempt = {}; emit('thingtime:password-provider-response', { id: current.request.id, error: { name: 'AbortError', message: 'The account or page changed.' } }); }
      clearPassword();
    };
  }, [finish, refresh]);
  const actions: TransientBlockActions = {
    'provider.refresh': refresh,
    'provider.cancel': () => {
      const operation = live.current;
      if (!operation || operation.request.id !== request?.id) return;
      finish({ error: { name: operation.excluded ? 'InvalidStateError' : 'NotAllowedError', message: operation.excluded ? 'The website excludes an existing saved passkey.' : 'Passkey request cancelled.' } }, operation.excluded ? 'Return to the website to use your existing passkey.' : 'Request cancelled.');
    },
    'provider.fallback': () => { if (!live.current?.excluded) finish({ fallback: true }, 'Continue with your browser’s other passkey provider.'); },
    'provider.approve': async invocation => {
      const operation = live.current;
      if (!operation || operation.busy || operation.excluded || !loaded || invocation.signal.aborted) return;
      let password = String(invocation.readField('password') || '');
      const selectedId = String(invocation.readField('credential') || choices[0]?.id || '');
      clearPassword();
      if (!password) { setError('Enter your Thingtime account password to verify this request.'); return; }
      operation.busy = true; setBusy(true); setError('');
      try {
        const response = await runProviderCeremony(operation.request, password, selectedId, vault, operation.controller.signal, operation.attempt);
        password = '';
        if (live.current === operation && !invocation.signal.aborted) finish({ response }, 'Passkey complete. Return to the website.');
      } catch (caught) {
        const failure = browserProviderFailure(caught, operation, live.current);
        if (failure) {
          if (failure.kind === 'excluded') { operation.excluded = true; setExcluded(true); }
          setError(failure.message);
        }
      } finally {
        password = ''; operation.busy = false;
        if (live.current === operation) setBusy(false);
      }
    },
  };
  if (!request) return <><Box display="flex" alignItems="center" gap={3}><PasswordBrandMark /><Text as="h1" fontSize="2xl" fontWeight={600}>Thingtime passkeys</Text></Box><Text my={4} role="status">{finished || 'Start a passkey request on a website using the Thingtime browser extension.'}</Text>{error && <Text role="alert">{error}</Text>}<Link to="/passwords">Open password manager</Link></>;
  return <div ref={fieldRoot}><SettingsDocumentHost documentKey="browser-password-provider" title="Passkey approval layout" defaultDocument={BROWSER_PROVIDER_BLOCKS} migrateBlocks={migrateBrowserProviderBranding} scopeKey={`${ownerId}:${request.id}`} layoutEditingDisabled={busy}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${ownerId}:${request.id}`} enabled={!editing} actions={actions} scope={{ result: {
      title: request.type === 'create' ? 'Save a passkey in Thingtime' : 'Sign in with a Thingtime passkey',
      origin: request.origin, rp: providerRp(request), account: request.publicKey.user?.name || '', choices,
      creating: request.type === 'create', choosing: request.type === 'get' && choices.length > 0,
      empty: loaded && request.type === 'get' && choices.length === 0,
      canApprove: !excluded && loaded && (request.type === 'create' || choices.length > 0), busy,
      refreshDisabled: busy || excluded, canRefresh: !excluded, canChooseProvider: !excluded, cancelLabel: excluded ? 'Return to website' : 'Cancel',
      approveLabel: request.type === 'create' ? 'Verify and save passkey' : 'Verify and sign in', hasError: !!error, error,
    } }} onError={() => setError('The control could not be used. Restore the default layout or try again.')}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost></div>;
}
