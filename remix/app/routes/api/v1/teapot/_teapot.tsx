import { json } from '~/api/http';

// 🔮 GET/POST /api/v1/teapot — the classic RFC 2324 egg (claude-todo/10).
// Deliberately absent from the /docs/api listing: devs exploring the
// self-describing API find it themselves (its -docs twin answers too — see
// the dispatcher). Always 418, never brews coffee.
const teapotPayload = {
	ok: false,
	error: "I'm a teapot",
	haiku: 'Water finds its heat / five minutes of patient steam / your tea knows the way 🫖',
	seeAlso: '/api/v1/teapot-docs'
};

export const loader = async () => json(teapotPayload, { status: 418 });
export const action = async () => json(teapotPayload, { status: 418 });
