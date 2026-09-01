export type FeatureStackLifecycleAction = 'pause' | 'stop' | 'restart';

export const FEATURE_STACK_USER_HELD_STATUSES = ['paused', 'stopped'] as const;

const ACTIVE_RUN_STATUSES = new Set(['accepted', 'in_progress', 'pending', 'queued', 'requested', 'running', 'waiting']);
const ACTIVE_STACK_STATUSES = new Set(['accepted', 'in_progress', 'pending', 'queued', 'requested', 'running', 'waiting']);

const normalized = (value: unknown) => String(value ?? '').trim().toLowerCase();

export const featureStackRunCanCancel = (status: unknown) => ACTIVE_RUN_STATUSES.has(normalized(status));

export const featureStackCanPause = (status: unknown) => ACTIVE_STACK_STATUSES.has(normalized(status));

export const featureStackCanStop = (status: unknown) => !['archived', 'stopped'].includes(normalized(status));

export const featureStackCanRestart = (status: unknown) => normalized(status) !== 'archived';

export const featureStackLifecycleStatus = (action: Exclude<FeatureStackLifecycleAction, 'restart'>) => action === 'pause' ? 'paused' : 'stopped';
