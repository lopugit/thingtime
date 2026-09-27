// Production composer; isolated presentation fixture with no account writes.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, ChakraProvider, Text } from '@chakra-ui/react';
import { LopuComposer } from '../app/components/Lopu/LopuComposer';
import type { LopuChatSettings } from '../app/components/Lopu/lopuChatStore';
function App() {
  const [settings, setSettings] = React.useState<LopuChatSettings>({ model: null, effort: null, speed: null, providerId: null, accessMode: 'ask' });
  const [text, setText] = React.useState('Please port my gear into Equipment');
  return <ChakraProvider><Box maxW="800px" mx="auto" p={4}>
    <Text mb={8}>Lopu chat access · isolated UI fixture</Text>
    <LopuComposer value={text} onChange={setText} onSend={() => {}} onStop={() => {}} streaming={false} models={[]} settings={settings} onSettingsChange={patch => setSettings(current => ({ ...current, ...patch }))} preferences={{ enterSends: true, applyPatches: true, confirmDeletes: true }} onPreferencesChange={() => {}} />
    <Text role="status" mt={4}>Saved choice: {settings.accessMode === 'full' ? 'Full access' : 'Ask before running'}</Text>
  </Box></ChakraProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
