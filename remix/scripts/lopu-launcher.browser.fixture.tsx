// Real UI and local persistence. Only identity/catalog/network replies are synthetic.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Flex, Button, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router';
import { ThingtimeProvider } from '../app/Providers/ThingtimeProvider';
import { useThingtime } from '../app/components/Thingtime/useThingtime';
import { useLopuSettings } from '../app/components/Lopu/useLopuSettings';
import { LopuHost } from '../app/components/Lopu/LopuHost';
import { LopuPage } from '../app/components/Lopu/LopuPage';
import { LopuNavButton } from '../app/components/Lopu/LopuNavButton';
import { SettingsContent } from '../app/components/Settings/SettingsContent';
import localforage from 'localforage';
import { parseThingtime } from '../app/Providers/thingtimeSerialization';
Object.defineProperty(window, 'SharedWorker', { value: undefined });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
window.fetch = async (input) => {
	const path = new URL(String(input), location.origin).pathname;
	if (path.includes('well-known'))
		return json({
			schemaVersion: 1,
			origin: location.origin,
			features: {
				'api.attachment-uploads': { version: '1.4.1' },
				'api.lopu-chats-reply': { version: '1.19.2' },
				'api.lopu-background-tasks': { version: '1.3.0' }
			}
		});
	if (path.endsWith('/ai/models'))
		return json({
			ok: true,
			models: Array.from({ length: 20 }, (_, i) => ({
				id: `model-${i + 1}`,
				label: `Test model ${String(i + 1).padStart(2, '0')}`,
				provider: 'openai',
				enabled: true,
				available: true,
				isDefault: i === 0,
				efforts: ['low', 'high'],
				speeds: ['normal', 'fast']
			})),
			defaults: { model: 'model-1', effort: 'high', speed: 'normal' },
			providers: { openai: { configured: true } }
		});
	if (path.endsWith('/settings/lopu-prompt')) return json({base:{basePrompt:'Synthetic isolated prompt',revision:null},personal:{revision:null,instructions:[]}});
	if (path.endsWith('/lopu/account')) return json({ ok: true, account: { verified: true, requireVerification: true, balanceMicros: 100000000 } });
	return json({ ok: true, ownerId: 'synthetic-popover-regression', chats: [], messages: [], tasks: [], things: [] });
};

function Surface() {
 const navigate = useNavigate();
 const { pathname } = useLocation();
 const { settings, loading } = useLopuSettings();
 const { flushThingtimePersistence } = useThingtime();
 React.useEffect(() => {
   Object.assign(window, { launcherEvidence: {
     flush: () => flushThingtimePersistence(),
     read: async () => {
       const raw = await localforage.getItem('lopu-launcher-acceptance');
       return (typeof raw === 'string' ? parseThingtime(raw) : raw)?.settings?.lopu;
     }
   } });
 }, [flushThingtimePersistence]);
 if (loading) return <Text>Preparing isolated preferences</Text>;
 return <>
   <Flex p={3} gap={2} wrap="wrap" align="center">
     <Button onClick={() => navigate('/')}>Home</Button>
     <Button onClick={() => navigate('/lopu')}>Full chat</Button>
     <Button onClick={() => navigate('/settings/lopu')}>User settings</Button>
     <LopuNavButton />
     <Text data-testid="preference-state">{JSON.stringify({launcher: settings.launcher, open: settings.open, minimised: settings.minimised})}</Text>
   </Flex>
   {pathname === '/lopu' ? <Box h="calc(100dvh - 100px)"><LopuPage /></Box> : pathname === '/settings/lopu' ? <Box maxW="800px" mx="auto" p={4}><SettingsContent tab="lopu" onTabChange={() => {}} /></Box> : <Box p={6}>Isolated launcher acceptance</Box>}
   <LopuHost />
 </>;
}
const router = createMemoryRouter([{id:'root',path:'*',loader:()=>({user:{id:'synthetic-popover-regression',username:'synthetic', privateUploadsEnabled:true,publicUploadsEnabled:true,storage:{remainingBytes:10000000,status:'ready'}}}),Component:()=> <ThingtimeProvider storageKey="lopu-launcher-acceptance" exposeGlobals={false}><Surface /></ThingtimeProvider>}],{initialEntries:['/']});
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router}/></ChakraProvider>);
