import React from 'react';
import { Box } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { requestMobileDevice, supportsMobileDevice, type MobileDeviceStatus } from './mobileDeviceBridge';
import { mobileDeviceScope, observeMobileDevice, publishMobileDeviceObservation, readMobileDeviceObservation } from './mobileDeviceObservations';
import { rootIdentity } from '~/utils/rootIdentity';
import { nativeBridgeReadyEvent } from '~/utils/nativeBridge';
import { MobileDeviceSetupCard } from './MobileDeviceSetupCard';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
const blocks: WebpageBlock[] = [{ id: 'mobile-device-setup-link', type: 'element', tag: 'a', text: 'Device setup', props: { href: '/things?deviceSetup=1' }, css: { display: 'inline-flex', 'min-height': '44px', 'align-items': 'center', padding: '8px 12px', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px', 'text-decoration': 'none' } }];
export function useMobileDeviceSetupStatus(enabled = true) {
 const user = useCurrentUser();
 const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
 const [available, setAvailable] = React.useState(supportsMobileDevice);
 const scope = enabled && available && user?.id && user.accountKind === 'user' && !user.temporary && !identity.pending
  ? mobileDeviceScope(window.location.origin, user.id, identity.generation) : null;
 const [observation, setObservation] = React.useState<{ scope: string; status: MobileDeviceStatus } | null>(null);
 React.useEffect(() => { const ready = () => setAvailable(supportsMobileDevice()); window.addEventListener(nativeBridgeReadyEvent, ready); return () => window.removeEventListener(nativeBridgeReadyEvent, ready); }, []);
 React.useEffect(() => {
  if (!scope || !user?.id) return;
  const controller = new AbortController();
  const observed = readMobileDeviceObservation(scope);
  if (observed) setObservation({ scope, status: observed });
  const unsubscribe = observeMobileDevice(scope, status => setObservation({ scope, status }));
  if (!observed) void requestMobileDevice(user.id, 'status', controller.signal).then(status => {
   if (!controller.signal.aborted && rootIdentity.read().generation === identity.generation && !rootIdentity.read().pending) publishMobileDeviceObservation(scope, status);
  }).catch(() => { /* Unknown pairing must not offer setup for an already paired device. */ });
  return () => { controller.abort(); unsubscribe(); };
 }, [scope, user?.id, identity.generation]);
 return scope ? (observation?.scope === scope ? observation.status : readMobileDeviceObservation(scope)) ?? null : null;
}
export function MobileDeviceSetupEntry() {
 const user = useCurrentUser();
 if (!user?.id) return null;
 return <SettingsDocumentHost documentKey="native-device-setup-entry" defaultDocument={blocks} scopeKey={user.id} title="Device setup" showLayoutControls={false}>{({ blocks, chrome }) => <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />}</SettingsDocumentHost>;
}
export function MobileDeviceSetupPage() {
 const user = useCurrentUser();
 return <Box width="100%" maxWidth="1100px" marginX="auto" paddingX={4} paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 24px)" paddingBottom={8}>
  <SettingsDocumentHost documentKey="native-device-setup-page" defaultDocument={[{ id: 'mobile-device-setup-back', type: 'element', tag: 'a', text: 'Back to Things', props: { href: '/things' }, css: { display: 'inline-flex', 'min-height': '44px', 'align-items': 'center' } }]} scopeKey={user?.id || 'signed-out'} title="Device setup">{({ blocks, chrome }) => <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />}</SettingsDocumentHost>
  {user?.id && <MobileDeviceSetupCard ownerId={user.id} />}
 </Box>;
}
