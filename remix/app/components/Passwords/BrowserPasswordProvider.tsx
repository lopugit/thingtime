import { BrowserExtensionAccounts } from './BrowserExtensionAccounts';
import React from 'react';
import { BrowserPasswordFillProvider } from './BrowserPasswordFillProvider';
import { passwordApprovalRequest, passwordVerificationRequest } from '~/passwords/client';
import { verificationWindow } from '~/passwords/verificationPolicy';
import { Box, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { PasswordBrandMark } from './PasswordBrandMark';
import { BROWSER_PROVIDER_BLOCKS, migrateBrowserProviderBranding } from './browserProviderBlocks';
import { browserProviderVault, browserProviderFailure, ensureBrowserProvider, loadProviderChoices, providerApprovalBudget, providerRp, runProviderCeremony, validateProviderRequest, type BrowserProviderAttempt, type ProviderChoice, type ProviderRequest } from '~/passwords/browserProviderCeremony';

const detailOf = (event: Event) => { const detail = (event as CustomEvent).detail; return typeof detail === 'string' ? JSON.parse(detail) : detail; };
const emit = (name: string, detail: Record<string, unknown>) => document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify({ version: 1, ...detail }) }));

export function BrowserPasswordProvider() {
  const user = useCurrentUser();
  if (new URLSearchParams(window.location.search).get('view') === 'accounts') return <BrowserExtensionAccounts />;
  if (new URLSearchParams(window.location.search).get('view') === 'vault') return <BrowserPasswordFillProvider />;
  return <Box maxW="640px" mx="auto" px={{ base: 4, md: 6 }} pt="calc(var(--thingtime-safe-area-top, 0px) + 32px)" pb={8}>
    {user && !user.temporary ? <ProviderSession key={user.id} ownerId={user.id} /> : <BrowserExtensionAccounts />}
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
  const [confirmation,setConfirmation] = React.useState({required:true,window:'always',revision:null as string|null});
  const confirmationVersion = React.useRef(0);
  const [windowChoice,setWindowChoice]=React.useState('');
  const live = React.useRef<{ request: ProviderRequest; receivedAt: number; controller: AbortController; attempt: BrowserProviderAttempt; busy: boolean; excluded: boolean } | null>(null);
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
  const inspectConfirmation = React.useCallback(async (operation:NonNullable<typeof live.current>, selectedId?:string) => {
    const version=++confirmationVersion.current;
    const context={purpose:operation.request.type,rp:providerRp(operation.request),...(operation.request.type==='get'?{entryId:selectedId}:{})};
    if(context.purpose==='get'&&!selectedId)return;
    const result=await passwordVerificationRequest(ownerId,{operation:'verification-status',context},operation.controller.signal);
    if(live.current===operation&&confirmationVersion.current===version)setConfirmation({required:result.required,window:result.window,revision:result.settings.revision});
  },[ownerId]);
  const refresh = React.useCallback(async () => {
    const operation = live.current;
    if (!operation || operation.busy || operation.excluded) return;
    operation.busy = true; setBusy(true); setError('');
    try {
      await ensureBrowserProvider(operation.controller.signal);
      const values = await loadProviderChoices(operation.request, vault, operation.controller.signal);
      if (live.current !== operation) return;
      setChoices(values); setLoaded(true); await inspectConfirmation(operation,values[0]?.id);
    } catch {
      if (live.current === operation) setError('Saved passkeys could not be loaded. Check your connection and refresh.');
    } finally {
      operation.busy = false;
      if (live.current === operation) setBusy(false);
    }
  }, [vault,inspectConfirmation]);
  React.useEffect(() => {
    const ready = () => emit('thingtime:password-provider-ready', {});
    const receive = (event: Event) => {
      let input: ProviderRequest | undefined;
      try {
        input = detailOf(event);
        if((input as any)?.expectedOwnerId&&(input as any).expectedOwnerId!==ownerId)throw Error('The selected Thingtime account changed.');
        const incoming = validateProviderRequest(input);
        const fontSize=(input as any)?.presentation?.fontSize;
        if(Number.isSafeInteger(fontSize)&&fontSize>0)document.documentElement.style.fontSize=`${fontSize}px`;
        document.title='Thingtime';
        if (live.current?.request.id === incoming.id) return;
        if (live.current) return; // A second request cannot replace current approval.
        live.current = { request: incoming, receivedAt: performance.now(), controller: new AbortController(), attempt: {}, busy: false, excluded: false };
        setWindowChoice(''); setConfirmation({required:true,window:'always',revision:null}); setRequest(incoming); setExcluded(false); setLoaded(false); setFinished(''); setError('');
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
    const lock = () => finish({ error: {name:'AbortError',message:'Current approvals ended.'} }, 'Current approvals ended.');
    const pagehide = () => finish({ error: { name: 'AbortError', message: 'The passkey page was closed.' } }, 'Request cancelled.');
    document.addEventListener('thingtime:password-provider-request', receive);
    document.addEventListener('thingtime:password-provider-cancel', cancel);
    document.addEventListener('thingtime:password-provider-init', ready);
    window.addEventListener('thingtime:hide-vault-values',lock);
    window.addEventListener('blur', hide);
    window.addEventListener('pagehide', pagehide);
    ready();
    return () => {
      document.removeEventListener('thingtime:password-provider-request', receive);
      document.removeEventListener('thingtime:password-provider-cancel', cancel);
      document.removeEventListener('thingtime:password-provider-init', ready);
      window.removeEventListener('thingtime:hide-vault-values',lock);
      window.removeEventListener('blur', hide); window.removeEventListener('pagehide', pagehide);
      if (live.current) { const current = live.current; live.current = null; current.controller.abort(); current.attempt = {}; emit('thingtime:password-provider-response', { id: current.request.id, error: { name: 'AbortError', message: 'The account or page changed.' } }); }
      clearPassword();
    };
  }, [finish, refresh, ownerId]);
  const actions: TransientBlockActions = {
    'provider.window':({value})=>{setWindowChoice(verificationWindow(value));setConfirmation(previous=>({...previous,required:true}));},
    'provider.refresh': refresh,
    'provider.cancel': () => {
      const operation = live.current;
      if (!operation || operation.request.id !== request?.id) return;
      const message = operation.excluded ? 'Return to the website to use your existing passkey.'
        : operation.busy && operation.attempt.writeId ? 'Request cancelled before Thingtime could confirm the save. Check the saved passkey before trying again.'
        : 'Request cancelled.';
      finish({ error: { name: operation.excluded ? 'InvalidStateError' : 'NotAllowedError', message: operation.excluded ? 'The website excludes an existing saved passkey.' : 'Passkey request cancelled.' } }, message);
    },
    'provider.fallback': () => { if (!live.current?.excluded) finish({ fallback: true }, 'Continue with your browser’s other passkey provider.'); },
    'provider.approve': async invocation => {
      const operation = live.current;
      if (!operation || operation.request.id !== request?.id || operation.busy || operation.excluded || !loaded || invocation.signal.aborted) return;
      let password = String(invocation.readField('password') || '');
      const selectedId = String(invocation.readField('credential') || choices[0]?.id || '');
      const selected = choices.find(choice => choice.id === selectedId) ?? null;
      clearPassword();
      if (operation.request.type === 'get' && !selected) { setError('Choose a saved passkey for this website.'); return; }
      if (!password && confirmation.required) { setError('Enter your Thingtime account password to verify this request.'); return; }
      const budget = providerApprovalBudget(operation.request, operation.receivedAt);
      if (!budget) { setError('Start a new passkey request from the website.'); return; }
      const deadline = AbortSignal.timeout(budget);
      const signal = AbortSignal.any([operation.controller.signal, invocation.signal, deadline]);
      operation.busy = true; setBusy(true); setError('');
      try {
        const window = verificationWindow(invocation.readField('verificationWindow') || confirmation.window);
        if(window!==confirmation.window){
          await passwordApprovalRequest(ownerId,{operation:'verification-settings',window,...(operation.request.type==='get'?{id:selectedId}:{revision:confirmation.revision})},signal);
          setConfirmation(previous=>({...previous,window,required:true}));
        }
        const response = await runProviderCeremony(operation.request, password, selected, browserProviderVault(ownerId, 'approval'), signal, operation.attempt);
        password = '';
        signal.throwIfAborted();
        if (live.current === operation) finish({ response }, 'Passkey complete. Return to the website.');
      } catch (caught) {
        const failure = deadline.aborted && live.current === operation
          ? { kind: 'retryable', message: operation.attempt.writeId
            ? 'This request ended before Thingtime could confirm the save. Check the saved passkey before trying again.'
            : 'This request is ending. Start a new passkey request from the website.' }
          : browserProviderFailure(caught, operation, live.current);
        if (failure) {
          if((caught as any)?.status===403)setConfirmation(previous=>({...previous,required:true}));
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
  return <div ref={fieldRoot} onChange={event=>{
    const input=event.target as HTMLInputElement, operation=live.current;
    if(!operation||operation.busy)return;
    if(input.name==='verificationWindow')setConfirmation(previous=>({...previous,required:true}));
    if(input.name==='credential'){setWindowChoice('');operation.attempt={};void inspectConfirmation(operation,input.value).catch(()=>{if(live.current===operation)setConfirmation(previous=>({...previous,required:true}));});}
  }}><SettingsDocumentHost documentKey="browser-password-provider" title="Passkey approval layout" defaultDocument={BROWSER_PROVIDER_BLOCKS} migrateBlocks={migrateBrowserProviderBranding} scopeKey={`${ownerId}:${request.id}`} layoutEditingDisabled={busy}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${ownerId}:${request.id}`} enabled={!editing} actions={actions} scope={{ result: {
      title: request.type === 'create' ? 'Save a passkey in Thingtime' : 'Sign in with a Thingtime passkey',
      origin: request.origin, rp: providerRp(request), account: request.publicKey.user?.name || '', choices,
      creating: request.type === 'create', choosing: request.type === 'get' && choices.length > 0,
      empty: loaded && request.type === 'get' && choices.length === 0,
      canApprove: !excluded && loaded && (request.type === 'create' || choices.length > 0), busy,
      refreshDisabled: busy || excluded, canRefresh: !excluded, canChooseProvider: !excluded, cancelLabel: excluded ? 'Return to website' : 'Cancel',
      needsPassword:confirmation.required, window:windowChoice||confirmation.window, verificationHelp:confirmation.required?'Confirm once to remember this choice on this device. Never persists across sign-ins. Websites and macOS may still require device verification.': 'This device is remembered for this account. Review and approve this new website request to continue.',
      approveLabel: !confirmation.required ? (request.type==='create'?'Save passkey':'Sign in') : request.type === 'create' ? 'Verify and save passkey' : 'Verify and sign in', hasError: !!error, error,
    } }} onError={() => setError('The control could not be used. Restore the default layout or try again.')}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost></div>;
}
