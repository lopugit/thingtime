import React from 'react';
import { Flex } from '@chakra-ui/react';
import { useNavigate } from 'react-router';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { PasswordPasskeySetup } from '../Passwords/PasswordPasskeySetup';
import { hasNativePasswordProvider } from '~/passwords/native.client';
import { SettingsDocumentHost } from './SettingsDocumentHost';
import { PASSWORD_MANAGER_SETTINGS_BLOCKS } from './passwordManagerSettingsBlocks';

export function PasswordManagerSettings({ ownerId, onNavigate }: { ownerId: string; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const [nativeAvailable, setNativeAvailable] = React.useState(hasNativePasswordProvider);
  React.useEffect(() => {
    const update = () => setNativeAvailable(hasNativePasswordProvider());
    update();
    window.addEventListener('thingtime:native-bridge-ready', update);
    return () => window.removeEventListener('thingtime:native-bridge-ready', update);
  }, []);
  const open = (to: string) => { onNavigate?.(); navigate(to); };
  const actions: TransientBlockActions = {
    'passwords.open': () => open('/passwords'),
    'passwords.security': () => open('/settings/security#account-passkeys'),
  };
  return <Flex id="password-manager" direction="column" gap={4} minW={0}>
    <SettingsDocumentHost documentKey="password-manager-settings" title="Password manager settings layout" defaultDocument={PASSWORD_MANAGER_SETTINGS_BLOCKS} scopeKey={ownerId}>
      {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={ownerId} scope={{}} actions={actions} enabled={!editing}>
        <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
      </TransientBlockHost>}
    </SettingsDocumentHost>
    <PasswordPasskeySetup ownerId={ownerId} nativeAvailable={nativeAvailable} />
  </Flex>;
}
