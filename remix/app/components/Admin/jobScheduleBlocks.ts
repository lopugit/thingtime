import type { WebpageBlock } from '../Builder/webpageBlocks';
import { SCHEDULED_HTTP_JOBS } from '~/api/utils/automation/scheduledJobs';

type Props = Record<string, unknown>;
function element(id: string, tag: string, text?: string, props: Props = {}, children?: WebpageBlock[]): WebpageBlock {
  const control = tag === 'select' || tag === 'button';
  const css: Record<string, string> = control ? { 'min-height': '44px', 'max-width': '100%', 'min-width': '0', padding: '7px 10px',
    'border-radius': '8px', border: '1px solid var(--tt-border, #ddd)', background: 'var(--tt-card, #fff)', color: 'inherit' } : {};
  if (tag === 'label') Object.assign(css, { display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: '8px' });
  if (tag === 'input' && props.type === 'checkbox') Object.assign(css, { width: '20px', height: '20px', 'accent-color': 'var(--tt-accent, #805ad5)' });
  if (tag === 'h2') Object.assign(css, { 'font-size': '18px', 'font-weight': '600' });
  return { css, id: 'job-schedule-' + id, type: 'element', tag, ...(text === undefined ? {} : { text }), props, ...(children ? { children } : {}) };
}
const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const label = (id: string, text: string, control: WebpageBlock) => element(id + '-field', 'label', undefined, {}, [element(id + '-label', 'span', text), control]);
export const JOB_SCHEDULE_BLOCKS: WebpageBlock[] = [{
  ...element('section', 'section', undefined, { 'aria-label': 'Scheduled jobs', 'aria-busy': '{jobs.busy}' }, [
    element('heading', 'h2', 'Scheduled jobs'),
    label('job', 'Job', element('job', 'select', undefined, { 'aria-label': 'Job', value: '{jobs.id}', disabled: '{jobs.selectDisabled}', ...action('job') },
      SCHEDULED_HTTP_JOBS.map(job => element(job.id, 'option', job.name, { value: job.id })))),
    element('frequency', 'p', '{jobs.description}'),
    label('enabled', 'Enable schedule', element('enabled', 'input', undefined, { 'aria-label': 'Enable schedule', type: 'checkbox', checked: '{jobs.enabled}', disabled: '{jobs.disabled}', ...action('enabled') })),
    label('hour', 'Start hour (UTC)', element('hour', 'select', undefined, { 'aria-label': 'Start hour (UTC)', value: '{jobs.hour}', disabled: '{jobs.disabled}', ...action('hour') },
      Array.from({ length: 24 }, (_, hour) => element('hour-' + hour, 'option', String(hour).padStart(2, '0') + ':00', { value: String(hour) })))),
    element('help', 'p', 'A delayed scheduler runs the job at its next check that day.'),
    element('save', 'button', 'Save schedule', { type: 'button', disabled: '{jobs.saveDisabled}', ...action('save') }),
    element('reload', 'button', 'Reload saved schedule', { type: 'button', disabled: '{jobs.busy}', ...action('reload') }),
    { id: 'job-schedule-loading', type: 'condition', condition: { arg: 'jobs.busy', equals: true }, children: [element('progress', 'progress', undefined, { 'aria-label': 'Updating schedule' })] },
    element('notice', 'p', '{jobs.notice}', { role: 'status' })
  ]),
  css: { display: 'grid', gap: '12px', padding: '18px', 'min-width': '0', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px' }
}];
