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
  return <ChakraProvider resetCSS={false}>{info ? <DesktopConnectionSettings recovery desktopInfo={info} onInfo={setInfo} /> :
    <p role="alert">Desktop settings could not be read. Close and reopen Thingtime, then try again.</p>}</ChakraProvider>;
}
