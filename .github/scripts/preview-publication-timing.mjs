import { performance } from 'node:perf_hooks';

const stages = new Set([
  'configuration', 'master-readiness', 'deployment-preparation',
  'prebuilt-upload', 'vercel-cli-upload', 'upload-guard', 'upload-reconciliation',
  'deployment-readiness', 'alias-and-smoke', 'cors-smoke',
  'github-deployment-record', 'github-status', 'github-comment', 'retention'
]);

// Passive diagnostics only. Neither operation values nor thrown values enter
// this logger, and a failed clock/logger must never change publication behavior.
export function createPublicationStageTimer({ now = () => performance.now(), write = line => console.log(line) } = {}) {
  const readClock = () => {
    try { const value = now(); return Number.isFinite(value) ? value : null; }
    catch { return null; }
  };
  const emit = (stage, status, elapsed) => {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > Number.MAX_SAFE_INTEGER) return;
    try { write(`[preview-publication] stage=${stage} status=${status} elapsed_ms=${Math.round(elapsed)}`); }
    catch { /* Logging is never a publication gate. */ }
  };
  return async (stage, operation) => {
    if (!stages.has(stage)) throw new Error('Unknown preview publication timing stage');
    const start = readClock();
    if (start !== null) emit(stage, 'started', 0);
    let status = 'failed';
    try {
      const result = await operation();
      status = 'succeeded';
      return result;
    } finally {
      const end = readClock();
      if (start !== null && end !== null) emit(stage, status, end - start);
    }
  };
}

export const timePublicationStage = createPublicationStageTimer();
