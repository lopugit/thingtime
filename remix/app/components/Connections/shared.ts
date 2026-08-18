// Shared client shapes + styling for the two Connections surfaces
// (/connections and /connections/feed) — one mirror of the server's
// PublicConnection projection, one card style, so the sibling pages can never
// drift apart.

export type ChannelRef = { id: string; title: string; thumbnail: string | null };

export type Connection = {
  id: string;
  provider: string;
  providerName: string;
  providerIcon: string;
  contentVisibility: 'public' | 'personal';
  auth?: 'none' | 'oauth2';
  account: { id: string; handle: string; displayName: string; avatarUrl: string | null; profileUrl: string | null };
  channels?: ChannelRef[];
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt?: string | null;
};

export const cardStyle = {
  background: 'var(--tt-card, #ffffff)',
  border: '1px solid var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-lg, 16px)'
} as const;
