import { defineHandler } from 'nitro/h3';
import { useStorage } from 'nitro/storage';

export default defineHandler(async () => {
  const html = await useStorage('assets:client').getItem<string>('index.html');

  if (!html) {
    return new Response('Client app has not been built yet.', { status: 503 });
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
});
