import React from 'react';
import { useDataPlane } from '~/hooks/useDataPlane';
import { AuthenticatorSetupSession, supportsAuthenticatorSetup, type SetupNotice } from '~/passwords/authenticatorSetup.client';
import type { PasswordEntry } from '~/passwords/model';
import { PasswordWorkspaceControls } from './PasswordWorkspaceControls';

type Draft = { id: string; revision: number; entry: PasswordEntry };
type Props = { ownerId: string; draft: Draft | null; busy: boolean; configured: boolean | null; onSetup: (value: string, previous: Draft | null) => void };

/** The seed travels only from the native inbox into the current editor draft.
 * Builder receives status and actions, never the URI or secret. */
export function PasswordAuthenticatorSetup(props: Props) {
  const plane = useDataPlane(), current = React.useRef(props);
  current.current = props;
  const consuming = React.useRef(false);
  const session = React.useRef<AuthenticatorSetupSession | null>(null);
  const [notice, setNotice] = React.useState<SetupNotice | null>(null);
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const bridge = window.thingtimeAuthenticatorSetup;
    if (!supportsAuthenticatorSetup(bridge) || plane !== 'home') return;
    let alive = true;
    const value = new AuthenticatorSetupSession({ ownerId: props.ownerId, dataPlane: plane, bridge, events: window,
      current: () => alive, onNotice: setNotice, onStatus: setMessage,
      onError: () => setMessage('Sign in to the configured account and retry setup.'),
    });
    session.current = value;
    const cancel = () => { value.cancel(); setMessage('Setup cancelled. Your existing draft is unchanged.'); };
    window.addEventListener('pagehide', cancel);
    window.addEventListener('thingtime:hide-vault-values', cancel);
    return () => { value.dispose(); alive = false; session.current = null; window.removeEventListener('pagehide', cancel); window.removeEventListener('thingtime:hide-vault-values', cancel); };
  }, [props.ownerId, plane]);
  const receive = async (create: boolean) => {
    const initial = current.current, value = session.current;
    if (!navigator.userActivation?.isActive || !notice || !value || consuming.current || initial.busy || initial.configured !== true || (create ? initial.draft !== null : !initial.draft || initial.draft.entry.passwordType === 'passkey')) return;
    consuming.current = true; setBusy(true);
    try {
      const setup = await value.consume(notice.requestId);
      if (session.current !== value || current.current.draft !== initial.draft || current.current.busy || current.current.configured !== true) return;
      initial.onSetup(setup, initial.draft);
      setMessage('Setup added to this draft. Review the account and select Save entry to keep it.');
    } catch { if (session.current === value) setMessage('Setup could not be added. Retry or reopen the setup code.'); }
    finally { consuming.current = false; if (session.current === value) setBusy(false); }
  };
  if (!notice && !message) return null;
  return <PasswordWorkspaceControls kind="setup" scopeKey={props.ownerId} scope={{
    busy: busy || props.busy, setupPending: Boolean(notice), setupMessage: message,
    setupCannotCreate: busy || props.busy || props.configured !== true || Boolean(props.draft),
    setupCannotAttach: busy || props.busy || props.configured !== true || !props.draft || props.draft.entry.passwordType === 'passkey',
  }} actions={{
    'setup.create': () => receive(true), 'setup.attach': () => receive(false),
    'setup.cancel': () => { session.current?.cancel(); setMessage('Setup cancelled. Your existing draft is unchanged.'); },
    'setup.retry': () => session.current?.retry(),
  }} />;
}
