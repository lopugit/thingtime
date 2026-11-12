/** Synthetic controlled drafts only; no account, server or real vault data. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, ChakraProvider, Text } from '@chakra-ui/react';
import { ThingFields } from '../app/components/Thingtime/ThingFields';
const fixtureValue = '  synthetic-copy-fixture\nexact whitespace  ';
const fields = [
  { id: 'password', label: 'Password', type: 'password' as const },
  { id: 'backup', label: 'Backup password with a long descriptive label', type: 'password' as const },
  { id: 'empty', label: 'Empty password', type: 'password' as const },
  { id: 'text', label: 'Username', type: 'text' as const }
];
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const wait = () => new Promise(resolve => setTimeout(resolve, 50));
const copy = () => document.querySelector<HTMLButtonElement>('button[aria-label="Copy Password"]')!;
const input = () => document.querySelector<HTMLInputElement>('input[aria-label="Password"]')!;
function Fixture() {
  const [values, setValues] = React.useState({ password: fixtureValue, backup: 'synthetic-backup-only', empty: '', text: 'synthetic@example.invalid' });
  const [epoch, remount] = React.useReducer(value => value + 1, 0);
  const [result, setResult] = React.useState('Ready. Copy uses the real browser clipboard until the regression starts.');
  const [running, setRunning] = React.useState(false);
  const run = async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    setRunning(true); setResult('Running synthetic checks…'); remount(); await wait();
    let writes = 0;
    try {
      let root = document.querySelector('[data-fields]')!;
      check(input().type === 'password', 'Initial password was revealed');
      check(document.querySelectorAll('button[aria-label="Copy Password"]').length === 1, 'Copy ignores the explicit opt-in');
      check(document.querySelector<HTMLButtonElement>('button[aria-label="Copy Empty password"]')!.disabled, 'Empty password can be copied');
      check(!document.querySelector('button[aria-label="Copy Username"]'), 'Non-password gained a copy control');
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { writes++; check(value === fixtureValue, 'Copied value differs from the controlled source'); } } });
      copy().click(); await wait();
      check(writes === 1 && root.textContent?.includes('Copied'), 'Successful write did not report success');
      check(input().type === 'password' && !root.textContent?.includes(fixtureValue), 'Copy revealed password text');
      document.querySelector<HTMLButtonElement>('button[aria-label="Show Password"]')!.click(); await wait();
      copy().click(); await wait(); check(input().type === 'text', 'Copy changed the revealed state');
      document.querySelector<HTMLButtonElement>('button[aria-label="Hide Password"]')!.click(); await wait();
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error(fixtureValue); } } });
      copy().click(); await wait();
      check(root.textContent?.includes('Could not copy.'), 'Rejected write did not report safe error');
      check(!root.textContent?.includes(fixtureValue) && input().type === 'password', 'Rejected write leaked or revealed the password');
      let finish!: () => void;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise<void>(resolve => { finish = resolve; }) } });
      copy().click(); await wait(); check(copy().disabled, 'Pending copy permits duplicate writes');
      window.dispatchEvent(new Event('thingtime:mask-vault-values')); await wait(); finish(); await wait();
      check(!root.textContent?.includes('Copied') && !root.textContent?.includes('Could not copy.'), 'Stale completion survived masking');
      copy().click(); await wait(); setValues(current => ({ ...current, password: 'synthetic-changed-draft' })); await wait(); finish(); await wait();
      check(!root.textContent?.includes('Copied'), 'Stale completion survived editing');
      copy().click(); await wait(); remount(); await wait(); finish(); await wait();
      root = document.querySelector('[data-fields]')!;
      check(!root.textContent?.includes('Copied'), 'Stale completion survived unmount');
      setValues(current => ({ ...current, password: fixtureValue })); await wait();
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      copy().click(); await wait(); check(root.textContent?.includes('Could not copy.'), 'Unavailable clipboard lacks safe error');
      window.scrollTo(0, document.documentElement.scrollHeight); await wait();
      check(document.documentElement.scrollWidth <= innerWidth + 1, 'Horizontal overflow');
      check(input().type === 'password', 'Password was revealed by a clipboard operation');
      setResult(`PASS · ${innerWidth}px · exact write, masked/empty/opt-in, safe rejected/unavailable clipboard, duplicate prevention, edit/mask fencing and overflow`);
    } catch (error) { setResult(`FAIL · ${error instanceof Error ? error.message : 'Synthetic regression failed'}`); }
    finally {
      if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor); else Reflect.deleteProperty(navigator, 'clipboard');
      setRunning(false);
    }
  };
  return <Box maxWidth="800px" mx="auto" p={{ base: 4, md: 8 }}><Text as="h1" fontSize="xl" fontWeight="bold">Synthetic password copy regression</Text><Text mt={2}>Controlled synthetic data only. No account, production API or vault requests. Manual Copy exercises the real browser clipboard; the regression replaces writes temporarily and never reads it.</Text><Button mt={4} isDisabled={running} onClick={() => void run()}>Run regression</Button><Text role="status" data-regression-status my={4}>{result}</Text><Box data-fields border="1px solid #ddd" borderRadius="12px" p={4}><ThingFields key={epoch} thing={values} mods={{ layout: 'fields', fields, revealSecrets: true, copyPasswords: true, sortable: true, removable: true }} onChange={next => setValues(next as typeof values)} onModsChange={() => {}} /></Box><Box mt={6}><Text>Opt-in disabled (no Copy button):</Text><ThingFields thing={{ password: fixtureValue }} mods={{ layout: 'fields', fields: [fields[0]] }} /></Box></Box>;
}
createRoot(document.getElementById('root')!).render(<ChakraProvider><Fixture /></ChakraProvider>);
