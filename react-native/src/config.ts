import Constants from 'expo-constants';

// API base URL resolution order:
//   1. EXPO_PUBLIC_API_BASE_URL env var (e.g. for local dev against the api/ server)
//   2. the `extra.apiBaseUrl` value baked into app.json
//   3. the production default
const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
const fromExtra = (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl;

export const API_BASE_URL = fromEnv || fromExtra || 'https://api.thingtime.com';
