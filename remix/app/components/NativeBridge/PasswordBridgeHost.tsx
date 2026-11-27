import React from 'react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { hasNativePasswordProvider, nativePasswordProvider } from '~/passwords/native.client';
// Send identity changes without exposing cookies to JavaScript. Native code
// reads only its own first-party HttpOnly cookie and verifies owner via the API.
export function PasswordBridgeHost() {
  const user = useCurrentUser();
  const ownerId = user?.id, temporary = user?.temporary;
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const sync = () => { clearTimeout(timer); timer = setTimeout(() => { if (hasNativePasswordProvider()) nativePasswordProvider('sync', ownerId && !temporary ? ownerId : undefined).catch(() => {}); }, 150); };
    const events = ['thingtime:native-bridge-ready', 'thingtime:passwords-changed', 'focus'];
    sync(); events.forEach(event => window.addEventListener(event, sync));
    return () => { clearTimeout(timer); events.forEach(event => window.removeEventListener(event, sync)); };
  }, [ownerId, temporary]);
  return null;
}
