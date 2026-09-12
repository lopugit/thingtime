import { randomUUID } from 'node:crypto';

// The native Widgets companion is a public OAuth client. This identity is not
// a secret and grants no access without browser consent and one-time S256 PKCE.
export const WIDGET_CLIENT_ID = 'ttapp_thingtime_widgets';
export const WIDGET_CALLBACK_URI = 'com.thingtime.widgets://oauth/callback';
export const widgetClientSeed = (schemaVersion: number, now = new Date()) => ({
  shareId: randomUUID(),
  schemaVersion,
  thingtime: ['app'],
  storageClass: 'control',
  ownerId: 'system',
  acl: ['tt:user'],
  targetId: null,
  tags: [],
  createdAt: now,
  updatedAt: now,
  crystal: {
    clientId: WIDGET_CLIENT_ID,
    name: 'Thingtime Widgets',
    origins: [],
    nativeRedirectUris: [WIDGET_CALLBACK_URI],
    // Widget content uses approved account Things or the read-only picker.
    // No app-owned storage quota is allocated to this built-in client.
    storageAllowanceBytes: 0,
    storageUsedBytes: 0,
    userStorageAllowanceBytes: 0
  }
});
