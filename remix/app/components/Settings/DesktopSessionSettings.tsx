import React from 'react';
import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import { getElectronBridge, type ThingtimeDesktopInfo } from '~/utils/electronBridge';

/** Reopen an explicitly identified browser workspace without copying its data. */
export function DesktopSessionSettings({ desktopInfo, onInfo }: {
 desktopInfo: ThingtimeDesktopInfo;
 onInfo: (info: ThingtimeDesktopInfo) => void;
}) {
 const [apiOrigin, setApiOrigin] = React.useState('');
 const [contentOrigin, setContentOrigin] = React.useState('');
 const [busy, setBusy] = React.useState(false);
 const [notice, setNotice] = React.useState<{ text: string; error?: boolean } | null>(null);
 const storage = desktopInfo.sessionStorage;
 const bridge = getElectronBridge();
 if (!storage || !bridge?.recoverDesktopSession) return null;
 const available = storage.recoveryAvailable && !desktopInfo.localRuntime?.active;
 const changeWorkspace = async (recover: boolean) => {
  if (!available || busy) return;
  setBusy(true);
  setNotice(null);
  try {
   const info = recover
    ? await bridge.recoverDesktopSession!({ apiOrigin: apiOrigin.trim(), contentOrigin: contentOrigin.trim() })
    : await bridge.useCurrentDesktopSession!({ apiOrigin: storage.legacyApiOrigin || '' });
   onInfo(info);
   setNotice({ text: 'If you confirmed the change, Thingtime will restart with that workspace. Cancelling leaves this workspace unchanged.' });
  } catch {
   setNotice({ text: 'The workspace could not be changed. Check the exact API and previous local URL, then try again.', error: true });
  } finally { setBusy(false); }
 };
 return <Box border="1px solid var(--tt-border, #ececef)" borderRadius="10px" p={3} minW={0} mb={3}>
  <Text fontWeight={600} fontSize="sm">Desktop session workspace</Text>
  <Text fontSize="xs" mt={2}>Currently using: {storage.mode === 'legacy' ? 'previous desktop workspace' : 'workspace for this API'}.</Text>
  <Text fontSize="xs" mt={2}>Recover an earlier desktop session by entering its exact API origin and local page URL. Thingtime reopens its cookies, local storage, and IndexedDB in place, including saved views and layout. Your newer workspace is kept separately. Data from other local ports is not combined.</Text>
  {storage.mode === 'legacy' && <Text fontSize="xs" mt={2} overflowWrap="anywhere">Previous workspace: {storage.legacyApiOrigin} · {storage.legacyContentOrigin}</Text>}
  {!available && <Text fontSize="xs" mt={2}>Session recovery is unavailable in local API mode and isolated development sessions.</Text>}
  <Text as="label" htmlFor="desktop-session-api-origin" display="block" fontSize="xs" mt={3}>Previous API origin</Text>
  <Input id="desktop-session-api-origin" type="url" autoComplete="off" size="sm" minW={0} mt={1} value={apiOrigin} isDisabled={busy || !available} onChange={event => setApiOrigin(event.target.value)} placeholder="https://your-thingtime.example" />
  <Text as="label" htmlFor="desktop-session-content-origin" display="block" fontSize="xs" mt={3}>Previous local page URL</Text>
  <Input id="desktop-session-content-origin" type="url" autoComplete="off" size="sm" minW={0} mt={1} value={contentOrigin} isDisabled={busy || !available} onChange={event => setContentOrigin(event.target.value)} placeholder="http://127.0.0.1:port" />
  <Text fontSize="xs" mt={2}>Use the exact port from the earlier app. The desktop confirmation shows both origins before restarting.</Text>
  <Flex gap={2} mt={3} flexWrap="wrap">
   <Button size="sm" whiteSpace="normal" height="auto" minH={8} py={1} isDisabled={!available || busy || !apiOrigin.trim() || !contentOrigin.trim()} onClick={() => void changeWorkspace(true)}>Recover previous workspace</Button>
   {storage.mode === 'legacy' && bridge.useCurrentDesktopSession && <Button size="sm" whiteSpace="normal" height="auto" minH={8} py={1} isDisabled={!available || busy} onClick={() => void changeWorkspace(false)}>Use newer workspace</Button>}
  </Flex>
  {notice && <Text role={notice.error ? 'alert' : 'status'} fontSize="xs" mt={2} color={notice.error ? 'red.500' : undefined}>{notice.text}</Text>}
 </Box>;
}
