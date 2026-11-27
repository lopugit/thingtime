import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { NativePasswordConnection } from './NativePasswordConnection';
import { PASSWORD_PASSKEY_BLOCKS, migratePasswordPasskeyBlocks } from './passwordPasskeyBlocks';

export type PasswordPasskeySetupProps = { ownerId: string; nativeAvailable: boolean };

/** This guide never reads or mutates the credential editor's in-memory draft. */
export function PasswordPasskeySetup({ ownerId, nativeAvailable }: PasswordPasskeySetupProps) {
  const [open, setOpen] = React.useState(false);
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
  React.useEffect(() => { setOpen(false); setNotice(''); }, [ownerId]);
  const scopeKey = `${ownerId}:passkey-setup:${nativeAvailable}`;
  const actions: TransientBlockActions = {
    'passkey.open': () => setOpen(value => !value),
    'passkey.extension': () => { document.dispatchEvent(new CustomEvent('thingtime:password-extension-configure', { detail: JSON.stringify({ version: 1 }) })); },
    'passkey.close': () => setOpen(false),
  };
  return <>{nativeAvailable && <NativePasswordConnection key={ownerId} ownerId={ownerId} />}<SettingsDocumentHost documentKey="password-passkey-setup" title="Passkey setup layout" defaultDocument={PASSWORD_PASSKEY_BLOCKS}
    scopeKey={ownerId} migrateBlocks={migratePasswordPasskeyBlocks}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} actions={actions} enabled={!editing}
      scope={{ result: { open, busy: false, nativeAvailable, webOnly: !nativeAvailable, extensionAvailable: extension.available,
        extensionMissing: !extension.available, extensionStatus: extension.enabled ? 'Thingtime browser passkeys are enabled for this browser.' : 'The extension is installed. Open extension settings to enable Thingtime passkeys.', hasNotice: !!notice, notice } }}
      onError={() => setNotice('This control could not be used. Try again or restore the default layout.')}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost></>;
}
