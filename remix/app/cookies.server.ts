import { createCookie } from '@remix-run/node'; // or cloudflare/deno

export const Session = createCookie('session', {
  // opts
});
