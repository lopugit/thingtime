import { createCookie } from './api/cookies';

export const Session = createCookie('session', {
  path: '/',
  sameSite: 'lax'
});
