import React from 'react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { hasNativePasswordProvider, nativePasswordProvider } from '~/passwords/native.client';
// Send identity changes without exposing cookies to JavaScript. Native code
// reads only its own first-party HttpOnly cookie and verifies owner via the API.
export function PasswordBridgeHost() {
  const user = useCurrentUser();
  React.useEffect(() => {
    const sync = () => { if (hasNativePasswordProvider()) nativePasswordProvider(user && !user.temporary ? 'sync' : 'disconnect', user?.id).catch(() => {}); };
    sync(); window.addEventListener('thingtime:native-bridge-ready', sync);
    return () => window.removeEventListener('thingtime:native-bridge-ready', sync);
  }, [user?.id, user?.temporary]);
  return null;
}
