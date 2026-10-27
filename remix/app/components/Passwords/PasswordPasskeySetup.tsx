import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { hasNativePasswordProvider, nativePasswordProvider } from '~/passwords/native.client';
import { PASSWORD_PASSKEY_BLOCKS, migratePasswordPasskeyBlocks } from './passwordPasskeyBlocks';

export type PasswordPasskeySetupProps = { ownerId: string; nativeAvailable: boolean };

/** This guide never reads or mutates the credential editor's in-memory draft. */
export function PasswordPasskeySetup({ ownerId, nativeAvailable }: PasswordPasskeySetupProps) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [extension, setExtension] = React.useState<{ available: boolean; enabled: boolean }>({ available: false, enabled: false });
  React.useEffect(() => {
    const status = (event: Event) => {
      try {
        const raw = (event as CustomEvent).detail;
        const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (value?.version === 1 && value.available === true && value.origin === window.location.origin) setExtension({ available: true, enabled: value.enabled === true });
      } catch { /* Ignore unrelated malformed events. */ }
    };
    const query = () => document.dispatchEvent(new CustomEvent('thingtime:password-extension-query', { detail: JSON.stringify({ version: 1 }) }));
    document.addEventListener('thingtime:password-extension-status', status);
    window.addEventListener('focus', query); query();
    return () => { document.removeEventListener('thingtime:password-extension-status', status); window.removeEventListener('focus', query); };
  }, []);
  const pending = React.useRef(false);
  const current = React.useRef({ ownerId, nativeAvailable });
  current.current = { ownerId, nativeAvailable };
  const mounted = React.useRef(false);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  React.useEffect(() => { setOpen(false); setNotice(''); }, [ownerId]);
  const scopeKey = `${ownerId}:passkey-setup:${nativeAvailable}`;
  const actions: TransientBlockActions = {
    'passkey.open': () => setOpen(value => !value),
    'passkey.extension': () => { document.dispatchEvent(new CustomEvent('thingtime:password-extension-configure', { detail: JSON.stringify({ version: 1 }) })); },
    'passkey.close': () => { if (!pending.current) setOpen(false); },
    'passkey.connect': async invocation => {
      if (pending.current || invocation.signal.aborted || !nativeAvailable || !hasNativePasswordProvider()) return;
      const selectedOwner = ownerId;
      const active = () => mounted.current && !invocation.signal.aborted && current.current.ownerId === selectedOwner && current.current.nativeAvailable;
      pending.current = true; setBusy(true); setNotice('');
      try {
        const result = await nativePasswordProvider('connect', selectedOwner);
        if (active()) setNotice(result.ok
          ? 'Password AutoFill connected. Enable Thingtime in your device’s AutoFill & Passwords settings, then create the passkey on the website or app.'
          : 'Password AutoFill could not connect. Check your Thingtime sign-in and native provider installation, then try again.');
      } catch {
        if (active()) setNotice('Password AutoFill could not connect. Check your Thingtime sign-in and native provider installation, then try again.');
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
  };
  return <SettingsDocumentHost documentKey="password-passkey-setup" title="Passkey setup layout" defaultDocument={PASSWORD_PASSKEY_BLOCKS}
    scopeKey={ownerId} layoutEditingDisabled={busy} migrateBlocks={migratePasswordPasskeyBlocks}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} actions={actions} enabled={!editing}
      scope={{ result: { open, busy, nativeAvailable, webOnly: !nativeAvailable, extensionAvailable: extension.available,
        extensionMissing: !extension.available, extensionStatus: extension.enabled ? 'Thingtime browser passkeys are enabled for this browser.' : 'The extension is installed. Open extension settings to enable Thingtime passkeys.', hasNotice: !!notice, notice } }}
      onError={() => setNotice('This control could not be used. Try again or restore the default layout.')}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
