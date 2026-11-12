#!/usr/bin/env node
// Seed the Customer/Invoice demo mini-app — the measurable proof that
// Data Thing + Component Thing + Action Thing = program (real API only).
//   node scripts/seed-demo-app.mjs [baseUrl] [username] [password]
// Creates (idempotently, keyed by name/actionKey):
//   💎 Customer + Invoice schemas (with {field} render templates so their
//      data things draw as cards on /things)
//   🧩 Customer Card + Invoice Card component things
//   ⚡ create-customer, generate-invoice, send-invoice actions (schema-ID
//      refs so the actions stay runnable by anyone who can see them)
// Prints the account so you can log in and click through /actions.
import { randomBytes } from 'node:crypto';

const BASE = process.argv[2] || process.env.TT_SEED_BASE || 'http://127.0.0.1:17052';
const USERNAME = process.argv[3] || process.env.TT_SEED_USER || `demo${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const PASSWORD = process.argv[4] || process.env.TT_SEED_PASS || 'Demo1234!pass';

const api = async (path, { cookie, method = 'GET', body } = {}) => {
	const response = await fetch(`${BASE}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	let json = null;
	try {
		json = await response.json();
	} catch {}
	return { status: response.status, body: json, setCookie: response.headers.get('set-cookie') || '' };
};

const authenticate = async () => {
	const login = await api('/api/v1/login', { method: 'POST', body: { username: USERNAME, password: PASSWORD } });
	if (login.status === 200 && /tt_auth=/.test(login.setCookie)) {
		return { cookie: /tt_auth=[^;]+/.exec(login.setCookie)[0], created: false };
	}
	const registered = await api('/api/v1/auth/register', {
		method: 'POST',
		body: { username: USERNAME, password: PASSWORD, email: `${USERNAME}@example.com` }
	});
	const match = /tt_auth=[^;]+/.exec(registered.setCookie);
	if (!match) throw new Error(`Could not log in or register ${USERNAME}: ${JSON.stringify(registered.body)}`);
	return { cookie: match[0], created: true };
};

// idempotency: reuse an existing owned thing by kind + crystal key
const findOwned = async (cookie, thingtime, keyField, keyValue) => {
	const list = await api(`/api/v1/things?thingtime=${thingtime}&limit=100`, { cookie });
	return (list.body?.things || []).find((thing) => thing?.crystal?.[keyField] === keyValue) || null;
};

const ensureThing = async (cookie, { thingtime, keyField, keyValue, payload }) => {
	const existing = await findOwned(cookie, thingtime, keyField, keyValue);
	if (existing) {
		// self-heal drift: PATCH the crystal when the seed definition changed
		if (JSON.stringify(existing.crystal) !== JSON.stringify(payload.crystal)) {
			const patched = await api('/api/v1/things/update', {
				cookie,
				method: 'PATCH',
				body: { id: existing.id, crystal: payload.crystal }
			});
			if (patched.status === 200 && patched.body?.thing) return { thing: patched.body.thing, created: false, refreshed: true };
		}
		return { thing: existing, created: false };
	}
	const created = await api('/api/v1/things', { cookie, method: 'POST', body: payload });
	if (created.status !== 200 || !created.body?.thing) {
		throw new Error(`Creating ${thingtime} ${keyValue} failed: ${JSON.stringify(created.body).slice(0, 300)}`);
	}
	return { thing: created.body.thing, created: true };
};

const run = async () => {
	console.log(`Seeding the Customer/Invoice demo app against ${BASE}\n`);
	const { cookie, created } = await authenticate();
	console.log(`  ${created ? 'Registered' : 'Signed in as'} ${USERNAME} (password: ${PASSWORD})\n`);

	// ---- 💎 Data: schemas with render templates -----------------------------
	const customerSchema = await ensureThing(cookie, {
		thingtime: 'schema',
		keyField: 'name',
		keyValue: 'customer',
		payload: {
			thingtime: ['schema'],
			crystal: {
				name: 'customer',
				description: 'A customer of your little demo business.',
				fields: [
					{ name: 'name', type: 'string', required: true, description: 'Full name.' },
					{ name: 'email', type: 'string', description: 'Contact email.' },
					{ name: 'note', type: 'string', description: 'Anything worth remembering.' }
				],
				render: {
					tag: 'div',
					props: { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 2px' } },
					children: [
						{ tag: 'div', props: { style: { fontWeight: '600', fontSize: '14px' } }, children: ['🧑‍💼 {name}'] },
						{ tag: 'div', props: { style: { fontSize: '12px', opacity: '0.65' } }, children: ['{email}'] },
						{ tag: 'div', props: { style: { fontSize: '12px', opacity: '0.5' } }, children: ['{note}'] }
					]
				}
			}
		}
	});
	console.log(`  💎 customer schema ${customerSchema.created ? 'created' : 'exists'} (${customerSchema.thing.id})`);

	const invoiceSchema = await ensureThing(cookie, {
		thingtime: 'schema',
		keyField: 'name',
		keyValue: 'invoice',
		payload: {
			thingtime: ['schema'],
			crystal: {
				name: 'invoice',
				description: 'An invoice raised against a customer.',
				fields: [
					{ name: 'customerId', type: 'string', required: true, description: 'The customer thing this bills.' },
					{ name: 'amount', type: 'number', description: 'Amount in dollars.' },
					{ name: 'status', type: 'string', description: 'draft | sent.' },
					{ name: 'sentAt', type: 'string', description: 'When it was sent.' },
					{ name: 'name', type: 'string', description: 'Display label.' }
				],
				render: {
					tag: 'div',
					props: { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 2px' } },
					children: [
						{ tag: 'div', props: { style: { fontWeight: '600', fontSize: '14px' } }, children: ['🧾 {name}'] },
						{ tag: 'div', props: { style: { fontSize: '13px' } }, children: ['$ {amount} — {status}'] },
						{ tag: 'div', props: { style: { fontSize: '11px', opacity: '0.55' } }, children: ['sent {sentAt}'] }
					]
				}
			}
		}
	});
	console.log(`  💎 invoice schema ${invoiceSchema.created ? 'created' : 'exists'} (${invoiceSchema.thing.id})`);

	// ---- 🧩 Components -------------------------------------------------------
	const customerCard = await ensureThing(cookie, {
		thingtime: 'component',
		keyField: 'componentKey',
		keyValue: 'demo-customer-card',
		payload: {
			thingtime: ['component'],
			crystal: {
				name: 'Customer Card',
				description: 'The demo customer card — pairs with the customer schema.',
				library: 'thingtime',
				category: 'demo',
				componentKey: 'demo-customer-card',
				args: [
					{ name: 'name', type: 'string', label: 'Name', default: 'Ada Lovelace', maxLength: 80 },
					{ name: 'email', type: 'string', label: 'Email', default: 'ada@example.com', maxLength: 120 }
				],
				render: {
					tag: 'div',
					props: {
						style: {
							display: 'flex',
							flexDirection: 'column',
							gap: '6px',
							padding: '14px 16px',
							border: '1px solid #ececef',
							borderRadius: '14px',
							background: '#ffffff',
							boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
						}
					},
					children: [
						{ tag: 'div', props: { style: { fontWeight: '600', fontSize: '15px', color: '#16161a' } }, children: ['🧑‍💼 {name}'] },
						{ tag: 'div', props: { style: { fontSize: '12px', color: '#9a9aa6' } }, children: ['{email}'] }
					]
				}
			}
		}
	});
	console.log(`  🧩 Customer Card ${customerCard.created ? 'created' : 'exists'} (${customerCard.thing.id})`);

	const invoiceCard = await ensureThing(cookie, {
		thingtime: 'component',
		keyField: 'componentKey',
		keyValue: 'demo-invoice-card',
		payload: {
			thingtime: ['component'],
			crystal: {
				name: 'Invoice Card',
				description: 'The demo invoice card — its Send button is the send-invoice action, run from /actions.',
				library: 'thingtime',
				category: 'demo',
				componentKey: 'demo-invoice-card',
				args: [
					{ name: 'label', type: 'string', label: 'Label', default: 'Invoice #0001', maxLength: 80 },
					{ name: 'amount', type: 'number', label: 'Amount', default: 250, min: 0, max: 100000 },
					{ name: 'status', type: 'enum', label: 'Status', values: ['draft', 'sent'], default: 'draft' },
					{ name: 'invoiceId', type: 'string', label: 'Invoice thing id', default: '', maxLength: 128 }
				],
				render: {
					tag: 'div',
					props: {
						style: {
							display: 'flex',
							flexDirection: 'column',
							gap: '8px',
							padding: '14px 16px',
							border: '1px solid #ececef',
							borderRadius: '14px',
							background: '#ffffff',
							boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
						}
					},
					children: [
						{ tag: 'div', props: { style: { fontWeight: '600', fontSize: '15px', color: '#16161a' } }, children: ['🧾 {name}'] },
						{ tag: 'div', props: { style: { fontSize: '13px', color: '#33333c' } }, children: ['$ {amount}'] },
						{
							ttIf: {
								arg: 'status',
								equals: 'sent',
								then: { tag: 'div', props: { style: { fontSize: '12px', color: '#2f9e63', fontWeight: '600' } }, children: ['✓ sent'] },
								else: {
									tag: 'div',
									// the ttAction closure: clicking this pill on a trusted
									// surface runs send-invoice AS the viewer with the card's
									// invoiceId arg — 🧩 component → ⚡ action → 📦 data
									ttAction: 'send-invoice',
									ttActionInputs: { invoiceId: '{invoiceId}' },
									props: {
										style: {
											alignSelf: 'flex-start',
											cursor: 'pointer',
											fontSize: '12px',
											fontWeight: '600',
											color: '#ffffff',
											background: '#16161a',
											padding: '5px 12px',
											borderRadius: '999px'
										}
									},
									children: ['⚡ Send invoice']
								}
							}
						}
					]
				}
			}
		}
	});
	console.log(`  🧩 Invoice Card ${invoiceCard.created ? 'created' : 'exists'} (${invoiceCard.thing.id})`);

	// ---- ⚡ Actions (schema-ID refs → runnable by anyone who can see them) ---
	const CUSTOMER_ID = customerSchema.thing.id;
	const INVOICE_ID = invoiceSchema.thing.id;

	const createCustomer = await ensureThing(cookie, {
		thingtime: 'action',
		keyField: 'actionKey',
		keyValue: 'create-customer',
		payload: {
			thingtime: ['action'],
			crystal: {
				name: 'Create customer',
				description: 'Creates a customer data thing from typed inputs.',
				actionKey: 'create-customer',
				category: 'demo',
				inputs: [
					{ name: 'name', type: 'string', label: 'Name', required: true, maxLength: 120 },
					{ name: 'email', type: 'string', label: 'Email', maxLength: 200 },
					{ name: 'note', type: 'string', label: 'Note', maxLength: 300 }
				],
				steps: [
					{ op: 'things.create', schema: CUSTOMER_ID, values: { name: '$input.name', email: '$input.email', note: '$input.note' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: [{ capability: 'things.create', schemas: [CUSTOMER_ID] }],
				limits: { timeoutMs: 5000, maxOperations: 10 }
			}
		}
	});
	console.log(`  ⚡ create-customer ${createCustomer.created ? 'created' : 'exists'} (${createCustomer.thing.id})`);

	const generateInvoice = await ensureThing(cookie, {
		thingtime: 'action',
		keyField: 'actionKey',
		keyValue: 'generate-invoice',
		payload: {
			thingtime: ['action'],
			crystal: {
				name: 'Generate invoice',
				description: 'Raises a draft invoice against a customer.',
				actionKey: 'generate-invoice',
				category: 'demo',
				inputs: [
					{ name: 'customerId', type: 'string', label: 'Customer thing id', required: true, maxLength: 128 },
					{ name: 'amount', type: 'number', label: 'Amount ($)', required: true, min: 0, max: 1000000 }
				],
				steps: [
					{ op: 'things.get', id: '$input.customerId' },
					{
						op: 'things.create',
						schema: INVOICE_ID,
						values: {
							customerId: '$input.customerId',
							amount: '$input.amount',
							status: 'draft',
							name: { ttConcat: ['Invoice for ', '$step.1.crystal.name'] }
						}
					},
					{ op: 'return', value: '$step.2' }
				],
				capabilities: [
					{ capability: 'things.read', schemas: [CUSTOMER_ID] },
					{ capability: 'things.create', schemas: [INVOICE_ID] }
				],
				limits: { timeoutMs: 5000, maxOperations: 10 }
			}
		}
	});
	console.log(`  ⚡ generate-invoice ${generateInvoice.created ? 'created' : 'exists'} (${generateInvoice.thing.id})`);

	const sendInvoice = await ensureThing(cookie, {
		thingtime: 'action',
		keyField: 'actionKey',
		keyValue: 'send-invoice',
		payload: {
			thingtime: ['action'],
			crystal: {
				name: 'Send invoice',
				description: 'Marks an invoice sent and stamps the send time. (No email capability exists in v1 — and the inspector proves it.)',
				actionKey: 'send-invoice',
				category: 'demo',
				inputs: [{ name: 'invoiceId', type: 'string', label: 'Invoice thing id', required: true, maxLength: 128 }],
				steps: [
					{ op: 'things.get', id: '$input.invoiceId' },
					{ op: 'things.update', id: '$input.invoiceId', values: { status: 'sent', sentAt: '$now' } },
					{ op: 'return', value: '$step.2' }
				],
				capabilities: [
					{ capability: 'things.read', schemas: [INVOICE_ID] },
					{ capability: 'things.update', schemas: [INVOICE_ID] }
				],
				limits: { timeoutMs: 5000, maxOperations: 10 }
			}
		}
	});
	console.log(`  ⚡ send-invoice ${sendInvoice.created ? 'created' : 'exists'} (${sendInvoice.thing.id})`);

	const onboard = await ensureThing(cookie, {
		thingtime: 'action',
		keyField: 'actionKey',
		keyValue: 'onboard-customer',
		payload: {
			thingtime: ['action'],
			crystal: {
				name: 'Onboard customer',
				description: 'Creates a customer AND their first invoice — composition on one shared budget.',
				actionKey: 'onboard-customer',
				category: 'demo',
				inputs: [
					{ name: 'name', type: 'string', label: 'Name', required: true, maxLength: 120 },
					{ name: 'amount', type: 'number', label: 'First invoice ($)', required: true, min: 0, max: 1000000 }
				],
				steps: [
					{ op: 'actions.invoke', action: 'create-customer', inputs: { name: '$input.name' } },
					{ op: 'actions.invoke', action: 'generate-invoice', inputs: { customerId: '$step.1.id', amount: '$input.amount' } },
					{ op: 'return', value: '$step.2' }
				],
				capabilities: [{ capability: 'actions.invoke', actions: ['create-customer', 'generate-invoice'] }],
				limits: { timeoutMs: 8000, maxOperations: 20 }
			}
		}
	});
	console.log(`  ⚡ onboard-customer ${onboard.created ? 'created' : 'exists'} (${onboard.thing.id})`);

	console.log(`\nDone. Log in as ${USERNAME} / ${PASSWORD} and open /actions 🥰`);
	console.log(`  Inspector deep links:`);
	console.log(`    /actions/${createCustomer.thing.id}`);
	console.log(`    /actions/${generateInvoice.thing.id}`);
	console.log(`    /actions/${sendInvoice.thing.id}`);
	console.log(`    /actions/${onboard.thing.id}`);
};

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
