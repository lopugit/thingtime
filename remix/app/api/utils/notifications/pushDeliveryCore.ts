export type PushDeliveryReport = {
  status: 'unconfigured' | 'no-devices' | 'accepted' | 'partial' | 'failed';
  attempted: number; accepted: number; rejected: number;
  ios: number; watchos: number; reasons: string[];
};
export function pushDeliveryMessage(report?: PushDeliveryReport) {
  const saved = 'Test saved in your notification history. ';
  if (!report) return saved + 'Push status is unavailable.';
  if (report.status === 'unconfigured') return saved + 'Native push is not configured on this server.';
  if (report.status === 'no-devices') return saved + 'No connected Apple devices. Open Thingtime on your iPhone and enable notifications in Settings → Notifications.';
  if (report.accepted) return saved + `Apple accepted delivery to ${report.ios} iPhone and ${report.watchos} Watch registration(s). ${report.rejected ? `${report.rejected} registration(s) failed. ` : ''}Check your device; Apple acceptance does not confirm a displayed banner.`;
  return saved + `Apple push failed (${report.reasons.join(', ') || 'delivery unavailable'}). Reconnect your iPhone in notification settings and retry.`;
}
