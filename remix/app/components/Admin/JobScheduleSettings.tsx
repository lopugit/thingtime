import React from 'react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { SCHEDULED_HTTP_JOBS, type JobPolicy } from '~/api/utils/automation/scheduledJobs';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { AdminSettingsScope, type AdminSettingsEditorProps } from './AdminSettingsScope';
import { JOB_SCHEDULE_BLOCKS } from './jobScheduleBlocks';

export function JobScheduleSettings() { return <AdminSettingsScope editor={Editor} />; }
function Editor({ scope, transport, dataPlane }: AdminSettingsEditorProps) {
  const { expectedActor, expectedApiOrigin } = scope;
  const [rows, setRows] = React.useState<JobPolicy[]>([]);
  const [draft, setDraft] = React.useState<JobPolicy | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [notice, setNotice] = React.useState('');
  const pending = React.useRef<AbortController | null>(null);
  const refresh = React.useCallback(async (id: string, update?: JobPolicy) => {
    if (pending.current) return;
    const current = new AbortController();
    pending.current = current;
    setBusy(true);
    setNotice('');
    try {
      if (dataPlane !== 'home') throw new Error('Select Home storage to manage job schedules.');
      await requireThingtimeCapability('api.admin-job-schedules', '1.0.0', expectedApiOrigin, { ...transport, signal: current.signal });
      const request = async (body?: JobPolicy) => {
        const response = await transport.fetch(new URL('/api/v1/admin/job-schedules', expectedApiOrigin).href, {
          method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', credentials: 'same-origin', signal: current.signal,
          headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': expectedActor, 'X-Thingtime-Expected-Data-Plane': 'home' },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
        const result = await response.json();
        if (!response.ok || result.ok !== true) throw new Error(result.error || 'Could not read or save this schedule.');
        return result;
      };
      if (update) await request(update);
      const result = await request();
      current.signal.throwIfAborted();
      transport.currentOrigin();
      const saved = result.jobs.find((row: JobPolicy) => row.id === id);
      if (!saved) throw new Error('The selected job schedule is unavailable.');
      setRows(result.jobs);
      setDraft(saved);
      if (update) setNotice(saved.enabled === update.enabled && saved.hour === update.hour ? 'Schedule saved.' : 'Another administrator updated this schedule.');
    } catch (error) { if (!current.signal.aborted) setNotice(error instanceof Error ? error.message : 'Could not load job schedules.'); }
    finally { if (pending.current === current) { pending.current = null; setBusy(false); } }
  }, [dataPlane, expectedActor, expectedApiOrigin, transport]);
  React.useEffect(() => {
    void refresh(SCHEDULED_HTTP_JOBS[0].id);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [refresh]);
  const id = draft?.id ?? SCHEDULED_HTTP_JOBS[0].id;
  const saved = rows.find(row => row.id === id);
  const dirty = !!draft && !!saved && (saved.enabled !== draft.enabled || saved.hour !== draft.hour);
  const display = { id, enabled: draft?.enabled ?? false, hour: String(draft?.hour ?? 0), busy, notice,
    disabled: busy || !draft, selectDisabled: busy || dirty || !draft, saveDisabled: busy || !dirty,
    description: SCHEDULED_HTTP_JOBS.find(job => job.id === id)?.weekday === 0 ? 'Once each Sunday.' : 'Once per day.' };
  const actions: TransientBlockActions = {
    job: ({ value }) => { if (!busy && !dirty) { setDraft(rows.find(row => row.id === value) ?? null); setNotice(''); } },
    enabled: ({ value }) => { if (draft && !busy) setDraft({ ...draft, enabled: value === true }); },
    hour: ({ value }) => { if (draft && !busy) setDraft({ ...draft, hour: Number(value) }); },
    save: () => { if (dirty && draft) return refresh(id, draft); }, reload: () => refresh(id)
  };
  const scopeKey = JSON.stringify([expectedActor, expectedApiOrigin]);
  return <SettingsDocumentHost documentKey="admin-job-schedule-settings" title="Scheduled jobs layout" scopeKey={scopeKey} accountTransport={transport} defaultDocument={JOB_SCHEDULE_BLOCKS}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={{ jobs: display }} enabled={!editing} actions={actions}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
