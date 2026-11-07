// Actual diagnostics inspector and client; all transport/data are synthetic.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, ChakraProvider } from '@chakra-ui/react';
import { LopuTaskDiagnostics } from '../app/components/Lopu/LopuTaskDiagnostics';
import { bindAiTaskOwner, refreshAiTasks } from '../app/components/Lopu/aiTasks.client';
let reads = 0, owner = 'synthetic-owner', scope = 'synthetic-scope';
Object.defineProperty(window, 'SharedWorker', { value: undefined });
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.origin !== location.origin || (init?.method && init.method !== 'GET')) throw new Error('Fixture refuses outbound/mutating requests');
  if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json({ schemaVersion: 1, origin: location.origin, features: { 'api.lopu-background-tasks': { version: '1.4.0' } } });
  if (url.pathname === '/api/v1/lopu/tasks') {
    if (!url.search) return Response.json({ ownerId: owner, contextKey: scope, tasks: [] });
    if (url.searchParams.get('diagnostics') !== '1') throw new Error('Output must not be read');
    reads++;
    return Response.json({ ownerId: owner, contextKey: scope, diagnostics: {
      taskId: 'synthetic-root', rootTaskId: 'synthetic-root', observedAt: '2026-10-27T00:00:00Z', consistency: 'non-atomic-read',
      workflowRunId: `wrun_${scope}_` + 'a'.repeat(100), workflowGatewayDeploymentId: 'dpl_' + 'b'.repeat(100),
      workflowFinalStatus: 'stopped', workflowFinalizedAt: null, conversationClaimRecorded: true, activeWorkerRequestId: 'synthetic-request',
      rootWorker: { id: 'synthetic-root', requestId: 'synthetic-request', workerStarted: true, workerFinishedAt: null }, reservedWorker: null, unacknowledgedWorker: null
    } });
  }
  throw new Error('Unrecognised fixture request');
};
Object.assign(window, { diagnosticReads: () => reads, changeDiagnosticScope: async () => { scope += '-next'; await refreshAiTasks(); }, changeDiagnosticOwner: async () => { owner += '-next'; bindAiTaskOwner(owner); await refreshAiTasks(); } });
bindAiTaskOwner('synthetic-owner'); await refreshAiTasks();
createRoot(document.getElementById('root')!).render(<ChakraProvider><Box maxW="700px" p={4} mx="auto"><LopuTaskDiagnostics task={{ id: 'synthetic-root' } as any} /></Box></ChakraProvider>);
