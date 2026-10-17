// Shared service presentation; adapters remain the source of authentication behavior.
export type ServiceGroup = { id: string; name: string; icon: string; about: string };
const groups: Record<string, ServiceGroup> = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    icon: '✳️',
    about: 'Save separate ChatGPT identities. Hosted sign-in requires an approved OpenAI client.'
  },
  google: {
    id: 'google',
    name: 'Google',
    icon: '🌈',
    about: 'Keep personal and work accounts together. Choose each service to grant only the access you need.'
  },
  meta: { id: 'meta', name: 'Meta', icon: '💬', about: 'Connect Facebook and Instagram accounts independently.' },
  reddit: { id: 'reddit', name: 'Reddit', icon: '👽', about: 'Your signed-in account and public communities.' },
  mastodon: { id: 'mastodon', name: 'Mastodon', icon: '🐘', about: 'Your home timeline and public profiles.' },
  bluesky: { id: 'bluesky', name: 'Bluesky', icon: '🦋', about: 'Your following timeline and public profiles.' },
  github: { id: 'github', name: 'GitHub', icon: '🐙', about: 'Follow public account activity.' }
};
export const serviceGroupFor = (provider: { id: string; name: string; icon: string }): ServiceGroup => {
  const id =
    provider.id.startsWith('google') || provider.id.startsWith('youtube')
      ? 'google'
      : ['facebook', 'facebook-account', 'instagram'].includes(provider.id)
      ? 'meta'
      : provider.id.replace(/-account$/, '');
  return groups[id] || { id, name: provider.name, icon: provider.icon, about: '' };
};

export const GOOGLE_SERVICES = [
  { id: 'google', name: 'Google account', about: 'Save your Google identity for later actions. No mail, files, or calendar access.', scopes: [] },
  {
    id: 'google-drive',
    name: 'Google Drive',
    about: 'Read file names and metadata in your Drive.',
    scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly']
  },
  {
    id: 'google-gmail',
    name: 'Gmail',
    about: 'Read email messages when you choose a Gmail action.',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly']
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    about: 'Read your calendars and events.',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly']
  },
  {
    id: 'google-docs',
    name: 'Google Docs',
    about: 'Read documents you select for a Docs action.',
    scopes: ['https://www.googleapis.com/auth/documents.readonly']
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    about: 'Read spreadsheets you select for a Sheets action.',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  },
  {
    id: 'google-contacts',
    name: 'Google Contacts',
    about: 'Read contacts when you choose a Contacts action.',
    scopes: ['https://www.googleapis.com/auth/contacts.readonly']
  }
] as const;
