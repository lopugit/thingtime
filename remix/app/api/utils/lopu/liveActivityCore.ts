export const LOPU_ACTIVITY_PURPOSE = 'lopu-chat-live-activity';
export const LOPU_ACTIVITY_MAX_CHATS = 100;
export const LOPU_ACTIVITY_LIFETIME_MS = 8 * 60 * 60 * 1000;
export type LopuActivityChat = { chatId: string; management: 'client' | 'server'; status: 'running' | 'retrying' };
export type LopuActivityState = { activeCount: number; serverCount: number; phase: 'running' | 'retrying' | 'finished' | 'needs-attention' };
export const validActivityIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 200 && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

export function normalizeLopuActivityInput(value: unknown) {
  const input = value as any;
  if (!input || !validActivityIdentifier(input.activityId) || !/^[0-9a-f]{32,400}$/i.test(input.token ?? '') || input.token.length % 2 || !['sandbox', 'production'].includes(input.environment)) return null;
  if (!Array.isArray(input.chats) || input.chats.length > LOPU_ACTIVITY_MAX_CHATS) return null;
  const chats: LopuActivityChat[] = [];
  const seen = new Set<string>();
  for (const chat of input.chats) {
    if (!validActivityIdentifier(chat?.chatId) || !['client', 'server'].includes(chat.management) || !['running', 'retrying'].includes(chat.status)) return null;
    if (!seen.has(chat.chatId)) { seen.add(chat.chatId); chats.push({ chatId: chat.chatId, management: chat.management, status: chat.status }); }
  }
  return { activityId: input.activityId as string, token: input.token.toLowerCase() as string, environment: input.environment as 'sandbox' | 'production', chats };
}

/** Select the newest root per chat; workflow checkpoints are not final completion. */
export function lopuActivityState(chats: LopuActivityChat[], tasks: any[]): LopuActivityState {
  let activeCount = 0, serverCount = 0, retrying = 0, needsAttention = false;
  for (const chat of chats) {
    if (chat.management === 'client') { activeCount++; if (chat.status === 'retrying') retrying++; continue; }
    const task = tasks.find(task => task.targetId === chat.chatId && !task.rootTaskId);
    // Missing or unreadable task status is not evidence of completion.
    if (!task) { activeCount++; serverCount++; continue; }
    const status = task.crystal?.workflowStatus ?? task.crystal?.status;
    if (status === 'running') { activeCount++; serverCount++; if (task.crystal?.stage === 'Retrying') retrying++; }
    else if (status === 'needs-attention') needsAttention = true;
  }
  return { activeCount, serverCount, phase: activeCount ? retrying === activeCount ? 'retrying' : 'running' : needsAttention ? 'needs-attention' : 'finished' };
}

export function lopuActivityPushPayload(state: LopuActivityState, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  return { aps: { timestamp, event: state.activeCount ? 'update' : 'end', 'content-state': state,
    ...(state.activeCount ? { 'stale-date': timestamp + 120 } : { 'dismissal-date': timestamp + 60 }) } };
}
