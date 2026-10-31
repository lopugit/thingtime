import { defineHandler } from 'nitro/h3';
import { appleAppAssociation } from '../../app/api/utils/auth/appleAppAssociation';
export default defineHandler((event) => {
	const method = event.req.method.toUpperCase();
	if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
	return new Response(method === 'HEAD' ? null : JSON.stringify(appleAppAssociation()), {
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
	});
});
