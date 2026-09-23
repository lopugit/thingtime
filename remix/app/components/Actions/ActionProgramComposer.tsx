import React from 'react';
import { Box, Button, Flex, Select, Text, Textarea } from '@chakra-ui/react';
import { useNavigate } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { sanitizeActionCrystal } from '~/schemas/registry';
import { DefinitionValueEditor } from '../Builder/DefinitionEditor/DefinitionValueEditor';
import { deriveRequiredCapabilities } from './actionInspect';
import { CARD_STYLES } from '~/theme/card';

export function ActionProgramComposer(props: { initial: Record<string, any>; onClose: () => void; onCreated?: (id: string) => void }) {
 const user = useCurrentUser();
 return <ProgramEditor key={user?.id || 'anonymous'} {...props} />;
}
function ProgramEditor({ initial, onClose, onCreated }: {
 initial: Record<string, any>; onClose: () => void; onCreated?: (id: string) => void;
}) {
 const api = useApi(); const user = useCurrentUser(); const navigate = useNavigate();
 const identity = React.useRef(user?.id); identity.current = user?.id;
 const mounted = React.useRef(true);
 React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
 const [source, setSource] = React.useState(() => JSON.stringify(initial, null, 2));
 const [mode, setMode] = React.useState('fields');
 const [error, setError] = React.useState('');
 const [saving, setSaving] = React.useState(false);
 const pending = React.useRef(false);
 let program: any = null;
 try { program = JSON.parse(source); } catch {}
 const setProgram = (value: any) => { setSource(JSON.stringify(value, null, 2)); setError(''); };
 const addStep = (op: string) => {
  const isRequest = op === 'http.request' || op === 'http.request.pages';
  const next = isRequest ? { op: 'http.request', ...(op === 'http.request.pages' ? { pagination: { cursorParam: 'cursor', cursorPath: 'nextCursor', itemsPath: 'things', itemKey: 'id', maxPages: 20, maxItems: 5000 } } : {}), method: 'GET', path: '/api/v1/things', feature: 'api.things', minimumVersion: '1.28.0', query: { limit: 20 } }
   : op === 'compute' ? { op, value: '' }
   : { op, action: 'child-action', inputs: {} };
  const steps = [...(program.steps || [])];
  const index = steps.at(-1)?.op === 'return' ? steps.length - 1 : steps.length;
  if (steps[index]?.op === 'return' && steps[index].value === `$step.${index}`) steps[index] = { ...steps[index], value: `$step.${index + 1}` };
  steps.splice(index, 0, next);
  setProgram({ ...program, ...(isRequest ? { runtime: 'browser' } : {}), steps, capabilities: deriveRequiredCapabilities(steps) });
 };
 const save = async () => {
  if (pending.current || !program) return;
  const checked = sanitizeActionCrystal(program);
  if (checked.ok === false) { setError(checked.error); return; }
  pending.current = true; setSaving(true); setError('');
  const actor = identity.current;
  try {
   const response = await api.v1.things.create({ thingtime: ['action'], crystal: program, acl: ['tt:user'], expectedActor: actor });
   if (!response?.ok || !response.thing?.id) throw new Error(response?.error || 'Could not create the Action');
   if (!mounted.current || identity.current !== actor) return;
   onCreated?.(response.thing.id); navigate(`/actions/${encodeURIComponent(response.thing.id)}`);
  } catch (failure: any) { if (mounted.current && identity.current === actor) setError(failure?.error || failure?.message || 'Could not create the Action'); }
  finally { pending.current = false; if (mounted.current) setSaving(false); }
 };
 return <Box {...CARD_STYLES} p={{ base: 4, md: 5 }}>
  <Flex justify="space-between" wrap="wrap" gap={2} mb={4}><Text fontWeight="700">New Action · full program</Text><Button size="sm" onClick={onClose} isDisabled={saving}>Close</Button></Flex>
  <Flex gap={2} mb={4} wrap="wrap">
   <Button size="sm" onClick={() => setMode('fields')} isDisabled={!program}>Fields</Button><Button size="sm" onClick={() => setMode('source')}>Source</Button>
   <Select size="sm" width="auto" value={program?.runtime || 'server'} aria-label="Action runtime" isDisabled={!program} onChange={(event) => setProgram({ ...program, runtime: event.target.value })}><option value="server">Server</option><option value="browser">Browser</option></Select>
  </Flex>
  {program?.runtime === 'browser' && program?.steps?.some?.((step: any) => typeof step?.op === 'string' && step.op.startsWith('things.')) ? <Text role="alert" fontSize="sm" mb={3}>Replace server Thing steps with request steps before saving a browser program.</Text> : null}
  <Text fontSize="sm" mb={3}>Edit inputs, steps, expressions and limits. Request steps use your current Thingtime session and the API’s existing permissions.</Text>
  {mode === 'fields' && program ? <DefinitionValueEditor value={program} onChange={setProgram} /> : <Textarea aria-label="Action program source" rows={20} value={source} onChange={(event) => { setSource(event.target.value); setError(''); }} fontFamily="mono" fontSize="sm" />}
  <Flex gap={2} my={4} wrap="wrap">
   <Button size="sm" isDisabled={!program} onClick={() => addStep('http.request')}>Add request</Button>
   <Button size="sm" isDisabled={!program} onClick={() => addStep('http.request.pages')}>Add paginated request</Button>
   <Button size="sm" isDisabled={!program} onClick={() => addStep('compute')}>Add computation</Button>
   <Button size="sm" isDisabled={!program} onClick={() => addStep('actions.invoke')}>Invoke Action</Button>
   <Button size="sm" isDisabled={!program} onClick={() => setProgram({ ...program, capabilities: deriveRequiredCapabilities(program.steps || []) })}>Derive permissions</Button>
  </Flex>
  {error || !program ? <Text role="alert" color="red.600" mb={3}>{error || 'The program contains invalid JSON.'}</Text> : null}
  <Button colorScheme="pink" onClick={() => void save()} isLoading={saving} isDisabled={!program}>Create Action</Button>
 </Box>;
}
