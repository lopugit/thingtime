import React from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { Thingtime } from '../Thingtime/Thingtime';
import type { ThingMods } from '../Thingtime/thingMods';
import type { AiBackgroundTask, AiTaskDiagnostics } from '~/api/utils/lopu/backgroundTaskCore';
import { getAiTaskIdentityKey, getServerAiTaskIdentityKey, readAiTaskDiagnostics, subscribeAiTasks } from './aiTasks.client';

// Explicitly selected, read-only inspector; never persisted in the Thing store.
export function LopuTaskDiagnostics({ task }: { task: AiBackgroundTask }) {
  const identity = React.useSyncExternalStore(subscribeAiTasks, getAiTaskIdentityKey, getServerAiTaskIdentityKey);
  return <DiagnosticsSession key={`${identity}:${task.id}`} task={task} />;
}
function DiagnosticsSession({ task }: { task: AiBackgroundTask }) {
  const [opened, setOpened] = React.useState(false);
  const [evidence, setEvidence] = React.useState<AiTaskDiagnostics | null>(null);
  const [notice, setNotice] = React.useState('');
  const operation = React.useRef(0);
  const regionId = React.useId();
  React.useEffect(() => () => { operation.current++; }, []);
  const inspect = async () => {
    setOpened(true); setNotice('Reading recorded evidence…');
    const current = ++operation.current;
    try {
      const result = await readAiTaskDiagnostics(task);
      if (current !== operation.current) return;
      setEvidence(result); setNotice(result ? '' : 'Task scope changed. Refresh the task list before inspecting again.');
    } catch {
      if (current === operation.current) setNotice('Diagnostics are unavailable. This origin needs background tasks 1.4.0 and access to the task conversation.');
    }
  };
  const thing: Record<string, string> = {};
  const fields: ThingMods['fields'] = [];
  const field = (id: string, label: string, value: unknown, section: string) => {
    thing[id] = value === null || value === undefined ? 'Unknown — no recorded evidence' : String(value);
    fields.push({ id, label, type: 'text', section, multiline: thing[id].length > 60 });
  };
  if (evidence) {
    field('task', 'Selected task ID', evidence.taskId, 'Identity');
    field('root', 'Root task ID', evidence.rootTaskId, 'Identity');
    field('run', 'Workflow run ID', evidence.workflowRunId, 'Identity');
    field('deployment', 'Admission deployment ID', evidence.workflowGatewayDeploymentId, 'Identity');
    field('observed', 'Observed at', evidence.observedAt, 'Observation');
    field('claim', 'Conversation claim', evidence.conversationClaimRecorded ? 'Recorded' : 'Not recorded at this read', 'Reservation and finalization');
    field('reservation', 'Reserved request ID', evidence.activeWorkerRequestId, 'Reservation and finalization');
    field('finalStatus', 'Finalizer requested outcome', evidence.workflowFinalStatus, 'Reservation and finalization');
    field('finalized', 'Application finalized at', evidence.workflowFinalizedAt, 'Reservation and finalization');
    for (const [key, label, worker] of [['rootWorker', 'Root worker', evidence.rootWorker], ['reservedWorker', 'Reserved worker', evidence.reservedWorker], ['unacknowledgedWorker', 'First worker without acknowledgment', evidence.unacknowledgedWorker]] as const) {
      field(`${key}-id`, 'Worker task ID', worker?.id, label);
      field(`${key}-request`, 'Worker request ID', worker?.requestId, label);
      field(`${key}-started`, 'Worker started', worker?.workerStarted, label);
      field(`${key}-finished`, 'Final output save acknowledged at', worker?.workerFinishedAt, label);
    }
  }
  return <Box mt={3} minW={0}>
    <Button size="sm" variant="ghost" aria-expanded={opened} aria-controls={regionId} onClick={() => {
      if (opened) { operation.current++; setOpened(false); setEvidence(null); setNotice(''); } else void inspect();
    }}>{opened ? 'Hide diagnostics' : 'Diagnostics'}</Button>
    {opened && <Box id={regionId} role="region" aria-label="Task diagnostics" mt={3} minW={0} sx={{ 'textarea[readonly]': { fieldSizing: 'content', overflowY: 'auto' } }}>
      <Text fontSize="sm" mb={3}>Recorded evidence only. Missing values are unknown. Reads are not atomic; neither an old task nor a completed provider step proves worker acknowledgment or a drained scope.</Text>
      {notice && <Text role="status" mb={3}>{notice}</Text>}
      {evidence && <Thingtime thing={thing} mods={{ layout: 'fields', fields }} />}
      <Button size="sm" variant="outline" mt={3} onClick={() => void inspect()}>Refresh diagnostics</Button>
    </Box>}
  </Box>;
}
