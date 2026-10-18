import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { getElectronBridge, type ThingtimeDesktopInfo } from '~/utils/electronBridge';
import { DesktopConnectionSettings } from './DesktopConnectionSettings';

/** No account providers, cached user data or remote API is needed to repair a connection. */
export function DesktopConnectionRecovery() {
  const [info, setInfo] = React.useState<ThingtimeDesktopInfo | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    const bridge = getElectronBridge();
    if (!bridge?.getInfo) return;
    let active = true;
    void bridge.getInfo().then(value => { if (active) setInfo(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  if (!info && !failed) return null;
  return <details style={{ marginTop: 24, padding: 16, border: '1px solid #ddd', borderRadius: 10, background: '#fff' }}>
    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>API and local runtime settings</summary>
    <p style={{ lineHeight: 1.6 }}>Choose a reachable API, or run Thingtime on this computer. These settings do not need a cloud session.</p>
    {info ? <ChakraProvider resetCSS={false}><DesktopConnectionSettings desktopInfo={info} onInfo={setInfo} /></ChakraProvider> :
      <p role="alert">Desktop settings could not be read. Close and reopen Thingtime, then try again.</p>}
  </details>;
}
