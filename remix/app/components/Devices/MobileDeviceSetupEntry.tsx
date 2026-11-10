import React from 'react';
import { Box } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { supportsMobileDevice } from './mobileDeviceBridge';
import { nativeBridgeReadyEvent } from '~/utils/nativeBridge';
import { MobileDeviceSetupCard } from './MobileDeviceSetupCard';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
const blocks: WebpageBlock[] = [{ id: 'mobile-device-setup-link', type: 'element', tag: 'a', text: 'Device setup', props: { href: '/things?deviceSetup=1' }, css: { display: 'inline-flex', 'min-height': '44px', 'align-items': 'center', padding: '8px 12px', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px', 'text-decoration': 'none' } }];
export function MobileDeviceSetupEntry() {
 const user = useCurrentUser(), [available, setAvailable] = React.useState(supportsMobileDevice);
 React.useEffect(() => { const ready = () => setAvailable(supportsMobileDevice()); window.addEventListener(nativeBridgeReadyEvent, ready); return () => window.removeEventListener(nativeBridgeReadyEvent, ready); }, []);
 if (!available || !user?.id || user.accountKind !== 'user' || user.temporary) return null;
 return <SettingsDocumentHost documentKey="native-device-setup-entry" defaultDocument={blocks} scopeKey={user.id} title="Device setup" showLayoutControls={false}>{({ blocks, chrome }) => <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />}</SettingsDocumentHost>;
}
export function MobileDeviceSetupPage() {
 const user = useCurrentUser();
 return <Box width="100%" maxWidth="1100px" marginX="auto" paddingX={4} paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 24px)" paddingBottom={8}>
  <SettingsDocumentHost documentKey="native-device-setup-page" defaultDocument={[{ id: 'mobile-device-setup-back', type: 'element', tag: 'a', text: 'Back to Things', props: { href: '/things' }, css: { display: 'inline-flex', 'min-height': '44px', 'align-items': 'center' } }]} scopeKey={user?.id || 'signed-out'} title="Device setup">{({ blocks, chrome }) => <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />}</SettingsDocumentHost>
  {user?.id && <MobileDeviceSetupCard ownerId={user.id} />}
 </Box>;
}
