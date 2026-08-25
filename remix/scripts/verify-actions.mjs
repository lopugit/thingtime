#!/usr/bin/env node
// Live verification of the Action Thing family — real API only (FUNDAMENTALS §2).
//   node scripts/verify-actions.mjs [baseUrl]
// Covers: the save-time grammar (closed vocabulary, capability coverage,
// scoped capabilities, ref validity, return placement, limits), the executor
// (create/get/search/update/invoke/return, $refs, $$ escape, ttConcat, $now),
// the budget envelope (ops exhaustion, recursion refusal — direct and A→B→A),
// run records (protected kind, owner-private history), and the auth gates.
import { randomBytes } from 'node:crypto';

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:17052';
let passed = 0;
const failures = [];
const check = (name, condition, detail = '') => {
	if (condition) {
		passed += 1;
		console.log(`  ✓ ${name}`);
	} else {
		failures.push(name);
		console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

const api = async (path, { cookie, method = 'GET', body, headers = {} } = {}) => {
	const response = await fetch(`${BASE}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	let json = null;
	try {
		json = await response.json();
	} catch {}
	return { status: response.status, body: json };
};

const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
const register = async (name) => {
	const username = `${name}${suffix}`;
	const response = await fetch(`${BASE}/api/v1/auth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password: 'Verify1234!pass', email: `${username}@example.com` })
	});
	const match = /tt_auth=[^;]+/.exec(response.headers.get('set-cookie') || '');
	const body = await response.json();
	if (!response.ok || !match) throw new Error(`registration failed for ${username}: ${JSON.stringify(body)}`);
	return { username, id: body.user.id, cookie: match[0] };
};

const createThing = (cookie, payload) => api('/api/v1/things', { cookie, method: 'POST', body: payload });
const runAction = (cookie, body) => api('/api/v1/actions/run', { cookie, method: 'POST', body });

const run = async () => {
	console.log(`Actions verification against ${BASE}\n`);

	const alice = await register('actv');
	const bella = await register('actw');

	// ---- data schemas the demo programs build on ---------------------------
	const customerSchema = await createThing(alice.cookie, {
		thingtime: ['schema'],
		crystal: {
			name: `customer-${suffix}`,
			description: 'Verification customer schema',
			fields: [
				{ name: 'name', type: 'string', required: true },
				{ name: 'email', type: 'string' },
				{ name: 'note', type: 'string' }
			]
		}
	});
	check('customer schema publishes', customerSchema.status === 200 && customerSchema.body?.thing?.id, JSON.stringify(customerSchema.body).slice(0, 200));
	const invoiceSchema = await createThing(alice.cookie, {
		thingtime: ['schema'],
		crystal: {
			name: `invoice-${suffix}`,
			description: 'Verification invoice schema',
			fields: [
				{ name: 'customerId', type: 'string', required: true },
				{ name: 'amount', type: 'number' },
				{ name: 'status', type: 'string' },
				{ name: 'sentAt', type: 'string' }
			]
		}
	});
	check('invoice schema publishes', invoiceSchema.status === 200 && invoiceSchema.body?.thing?.id);
	const CUSTOMER = `customer-${suffix}`;
	const INVOICE = `invoice-${suffix}`;
	// Shareable actions should reference schemas by ID (public schema things
	// resolve for any viewer); NAME refs are an owner-side convenience.
	const CUSTOMER_ID = customerSchema.body?.thing?.id;

	// ---- save-time grammar --------------------------------------------------
	const unknownOp = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: { name: 'Bad', steps: [{ op: 'shell.exec', cmd: 'rm -rf /' }] }
	});
	check('unknown op is refused (closed vocabulary)', unknownOp.status === 400 && /closed/.test(unknownOp.body?.error || ''));

	const uncovered = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: { name: 'Bad', steps: [{ op: 'things.create', schema: CUSTOMER, values: { name: 'x' } }] }
	});
	check('step without declared capability is refused', uncovered.status === 400 && /capability/.test(uncovered.body?.error || ''));

	const outOfScope = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Bad',
			steps: [{ op: 'things.create', schema: CUSTOMER, values: { name: 'x' } }],
			capabilities: [{ capability: 'things.create', schemas: [INVOICE] }]
		}
	});
	check('capability schema scope mismatch is refused', outOfScope.status === 400 && /scoped/.test(outOfScope.body?.error || ''));

	const forwardRef = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Bad',
			steps: [
				{ op: 'things.create', schema: CUSTOMER, values: { name: '$step.2.id' } },
				{ op: 'return', value: '$step.1' }
			],
			capabilities: [{ capability: 'things.create', schemas: [CUSTOMER] }]
		}
	});
	check('forward $step reference is refused', forwardRef.status === 400 && /before it has run/.test(forwardRef.body?.error || ''));

	const undeclaredInput = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Bad',
			steps: [{ op: 'things.create', schema: CUSTOMER, values: { name: '$input.nope' } }],
			capabilities: [{ capability: 'things.create', schemas: [CUSTOMER] }]
		}
	});
	check('undeclared $input reference is refused', undeclaredInput.status === 400 && /no such input/.test(undeclaredInput.body?.error || ''));

	const midReturn = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Bad',
			steps: [
				{ op: 'return', value: 'early' },
				{ op: 'things.create', schema: CUSTOMER, values: { name: 'x' } }
			],
			capabilities: [{ capability: 'things.create', schemas: [CUSTOMER] }]
		}
	});
	check('return must be the last step', midReturn.status === 400 && /last step/.test(midReturn.body?.error || ''));

	const badLimit = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: { name: 'Bad', steps: [{ op: 'return', value: 1 }], limits: { fork: 999 } }
	});
	check('unknown limit key is refused', badLimit.status === 400 && /Unknown limit/.test(badLimit.body?.error || ''));

	const reserved = await createThing(alice.cookie, {
		thingtime: ['action'],
		shareId: 'action-squatted',
		crystal: { name: 'Bad', steps: [{ op: 'return', value: 1 }] }
	});
	check('reserved action- shareId is refused', reserved.status === 400);

	// ---- a real program: create-customer ------------------------------------
	const createCustomer = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Create customer',
			description: 'Creates a customer from typed inputs.',
			actionKey: `create-customer-${suffix}`,
			category: 'customers',
			inputs: [
				{ name: 'name', type: 'string', label: 'Name', required: true, maxLength: 120 },
				{ name: 'email', type: 'string', label: 'Email', maxLength: 200 }
			],
			steps: [
				{ op: 'things.create', schema: CUSTOMER_ID, values: { name: '$input.name', email: '$input.email', note: '$$100 club' } },
				{ op: 'return', value: '$step.1' }
			],
			capabilities: [{ capability: 'things.create', schemas: [CUSTOMER_ID] }],
			limits: { timeoutMs: 900000, maxOperations: 10 }
		}
	});
	check('create-customer action saves', createCustomer.status === 200 && createCustomer.body?.thing?.id, JSON.stringify(createCustomer.body).slice(0, 200));
	const createCustomerId = createCustomer.body?.thing?.id;
	check(
		'declared limits clamp to the server ceiling',
		createCustomer.body?.thing?.crystal?.limits?.timeoutMs === 10000,
		`timeoutMs=${createCustomer.body?.thing?.crystal?.limits?.timeoutMs}`
	);

	const anonRun = await api('/api/v1/actions/run', { method: 'POST', body: { action: createCustomerId } });
	check('anonymous run is 401', anonRun.status === 401);

	const missingInput = await runAction(alice.cookie, { action: createCustomerId, inputs: {} });
	check('missing required input is 400', missingInput.status === 400 && /required/.test(missingInput.body?.error || ''));

	const unknownInput = await runAction(alice.cookie, { action: createCustomerId, inputs: { name: 'Ada', nope: 1 } });
	check('unknown input is 400', unknownInput.status === 400 && /Unknown input/.test(unknownInput.body?.error || ''));

	const run1 = await runAction(alice.cookie, { action: `create-customer-${suffix}`, inputs: { name: 'Ada Lovelace', email: 'ada@example.com' } });
	check('run by actionKey succeeds', run1.status === 200 && run1.body?.ok === true && run1.body?.status === 'ok', JSON.stringify(run1.body).slice(0, 300));
	check('run returns the created thing', typeof run1.body?.result?.id === 'string');
	check('run reports budget usage', run1.body?.opsUsed === 1 && run1.body?.depthUsed === 0);
	check('run carries a per-step trace', Array.isArray(run1.body?.trace) && run1.body.trace.length === 2 && run1.body.trace[0].op === 'things.create');
	check('run mints an action-run id', typeof run1.body?.runId === 'string' && run1.body.runId.startsWith('action-run-'));

	const customerId = run1.body?.result?.id;
	const createdCustomer = await api(`/api/v1/things?id=${encodeURIComponent(customerId || 'missing')}`, { cookie: alice.cookie });
	const createdCrystal = createdCustomer.body?.thing?.crystal || {};
	check('created customer is a real data thing', createdCustomer.status === 200 && createdCrystal.name === 'Ada Lovelace');
	check('schema provenance is stamped', createdCrystal.schema === CUSTOMER && typeof createdCrystal.schemaId === 'string');
	check('$$ escapes a literal dollar', createdCrystal.note === '$100 club');

	// ---- invoice flow: create + send (get/update + $now + ttConcat) ---------
	const generateInvoice = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Generate invoice',
			actionKey: `generate-invoice-${suffix}`,
			inputs: [
				{ name: 'customerId', type: 'string', required: true },
				{ name: 'amount', type: 'number', required: true, min: 0 }
			],
			steps: [
				{
					op: 'things.create',
					schema: INVOICE,
					values: { customerId: '$input.customerId', amount: '$input.amount', status: 'draft', label: { ttConcat: ['Invoice for ', '$input.customerId'] } }
				},
				{ op: 'return', value: '$step.1' }
			],
			capabilities: [{ capability: 'things.create', schemas: [INVOICE] }]
		}
	});
	check('generate-invoice action saves', generateInvoice.status === 200);

	const sendInvoice = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Send invoice',
			actionKey: `send-invoice-${suffix}`,
			inputs: [{ name: 'invoiceId', type: 'string', required: true }],
			steps: [
				{ op: 'things.get', id: '$input.invoiceId' },
				{ op: 'things.update', id: '$input.invoiceId', values: { status: 'sent', sentAt: '$now' } },
				{ op: 'return', value: '$step.2' }
			],
			capabilities: [
				{ capability: 'things.read', schemas: [INVOICE] },
				{ capability: 'things.update', schemas: [INVOICE] }
			]
		}
	});
	check('send-invoice action saves', sendInvoice.status === 200);

	const invRun = await runAction(alice.cookie, { action: `generate-invoice-${suffix}`, inputs: { customerId: customerId || 'x', amount: 250 } });
	const invoiceId = invRun.body?.result?.id;
	check('generate-invoice runs', invRun.status === 200 && invRun.body?.status === 'ok' && typeof invoiceId === 'string');
	check('ttConcat composes strings', invRun.body?.result?.crystal?.label === `Invoice for ${customerId}`);

	const sendRun = await runAction(alice.cookie, { action: `send-invoice-${suffix}`, inputs: { invoiceId } });
	check('send-invoice runs (get + update)', sendRun.status === 200 && sendRun.body?.status === 'ok', JSON.stringify(sendRun.body).slice(0, 300));
	const sentInvoice = await api(`/api/v1/things?id=${encodeURIComponent(invoiceId || 'missing')}`, { cookie: alice.cookie });
	const sentCrystal = sentInvoice.body?.thing?.crystal || {};
	check('invoice.status became sent', sentCrystal.status === 'sent');
	check('$now stamped sentAt as ISO time', typeof sentCrystal.sentAt === 'string' && !Number.isNaN(Date.parse(sentCrystal.sentAt)));

	// update outside the declared scope must fail at run time
	const scopeRun = await runAction(alice.cookie, { action: `send-invoice-${suffix}`, inputs: { invoiceId: customerId } });
	check(
		'update outside the capability scope fails at run time',
		scopeRun.status === 200 && scopeRun.body?.status === 'error' && /scope/.test(scopeRun.body?.error || ''),
		JSON.stringify(scopeRun.body).slice(0, 200)
	);

	// ---- composition + shared budget ---------------------------------------
	const composed = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Create customer and invoice',
			actionKey: `compose-${suffix}`,
			inputs: [{ name: 'name', type: 'string', required: true }],
			steps: [
				{ op: 'actions.invoke', action: `create-customer-${suffix}`, inputs: { name: '$input.name' } },
				{ op: 'actions.invoke', action: `generate-invoice-${suffix}`, inputs: { customerId: '$step.1.id', amount: 100 } },
				{ op: 'return', value: '$step.2' }
			],
			capabilities: [{ capability: 'actions.invoke', actions: [`create-customer-${suffix}`, `generate-invoice-${suffix}`] }]
		}
	});
	check('composed action saves with an invoke allowlist', composed.status === 200, JSON.stringify(composed.body).slice(0, 200));

	const allowlistViolation = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Bad',
			steps: [{ op: 'actions.invoke', action: 'not-allowed' }],
			capabilities: [{ capability: 'actions.invoke', actions: ['something-else'] }]
		}
	});
	check('invoke outside the allowlist is refused at save', allowlistViolation.status === 400 && /allowlist/.test(allowlistViolation.body?.error || ''));

	const composedRun = await runAction(alice.cookie, { action: `compose-${suffix}`, inputs: { name: 'Grace Hopper' } });
	check('composed run succeeds', composedRun.status === 200 && composedRun.body?.status === 'ok', JSON.stringify(composedRun.body).slice(0, 300));
	check('children consumed the SHARED budget', composedRun.body?.opsUsed === 4 && composedRun.body?.childActionsUsed === 2 && composedRun.body?.depthUsed === 1);
	check('nested trace labels steps hierarchically', (composedRun.body?.trace || []).some((entry) => entry.step === '1.1'));

	// ---- recursion refusal ---------------------------------------------------
	const selfRef = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Ouroboros',
			actionKey: `ouro-${suffix}`,
			steps: [{ op: 'actions.invoke', action: `ouro-${suffix}` }],
			capabilities: [{ capability: 'actions.invoke' }]
		}
	});
	check('self-invoking action saves (refusal is a run-time property)', selfRef.status === 200);
	const selfRun = await runAction(alice.cookie, { action: `ouro-${suffix}` });
	check(
		'direct recursion is refused at run time',
		selfRun.status === 200 && selfRun.body?.status === 'error' && /Recursive invocation refused/.test(selfRun.body?.error || ''),
		JSON.stringify(selfRun.body).slice(0, 200)
	);

	const pingKey = `ping-${suffix}`;
	const pongKey = `pong-${suffix}`;
	const ping = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Ping',
			actionKey: pingKey,
			steps: [{ op: 'actions.invoke', action: pongKey }],
			capabilities: [{ capability: 'actions.invoke' }]
		}
	});
	const pong = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Pong',
			actionKey: pongKey,
			steps: [{ op: 'actions.invoke', action: pingKey }],
			capabilities: [{ capability: 'actions.invoke' }]
		}
	});
	check('ping/pong pair saves', ping.status === 200 && pong.status === 200);
	const cycleRun = await runAction(alice.cookie, { action: pingKey });
	check(
		'A→B→A cycles terminate with a refusal',
		cycleRun.status === 200 && cycleRun.body?.status === 'error' && /Recursive invocation refused|budget exhausted/i.test(cycleRun.body?.error || '')
	);

	// ---- ops budget exhaustion ----------------------------------------------
	const budgetAction = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Budget burner',
			actionKey: `burner-${suffix}`,
			steps: [
				{ op: 'things.create', schema: CUSTOMER, values: { name: 'one' } },
				{ op: 'things.create', schema: CUSTOMER, values: { name: 'two' } },
				{ op: 'things.create', schema: CUSTOMER, values: { name: 'three' } }
			],
			capabilities: [{ capability: 'things.create', schemas: [CUSTOMER] }],
			limits: { maxOperations: 2 }
		}
	});
	check('budget-burner saves', budgetAction.status === 200);
	const budgetRun = await runAction(alice.cookie, { action: `burner-${suffix}` });
	check(
		'operation budget exhausts mid-run',
		budgetRun.status === 200 && budgetRun.body?.status === 'error' && /Operation budget exhausted/.test(budgetRun.body?.error || '') && budgetRun.body?.opsUsed === 2
	);

	// ---- run records ---------------------------------------------------------
	const forge = await createThing(alice.cookie, {
		thingtime: ['action-run'],
		targetId: createCustomerId,
		crystal: { status: 'ok', startedAt: new Date().toISOString(), durationMs: 1, opsUsed: 0 }
	});
	check('forged action-run via generic path is refused', forge.status === 403);

	const runsList = await api(`/api/v1/actions/runs?action=${encodeURIComponent(createCustomerId)}`, { cookie: alice.cookie });
	const runs = runsList.body?.runs || [];
	check('run history lists the recorded run', runsList.status === 200 && runs.some((entry) => entry.id === run1.body?.runId));
	check('run records carry the trace', runs.length > 0 && Array.isArray(runs[0].trace));
	const anonRuns = await api('/api/v1/actions/runs');
	check('anonymous runs list is 401', anonRuns.status === 401);
	const bellaRuns = await api(`/api/v1/actions/runs?action=${encodeURIComponent(createCustomerId)}`, { cookie: bella.cookie });
	check('run history is owner-private', bellaRuns.status === 200 && (bellaRuns.body?.runs || []).length === 0);

	// ---- action privacy ------------------------------------------------------
	const privateAction = await createThing(alice.cookie, {
		thingtime: ['action'],
		acl: ['tt:user'],
		crystal: { name: 'Private action', actionKey: `private-${suffix}`, steps: [{ op: 'return', value: 'secret' }] }
	});
	const privateId = privateAction.body?.thing?.id;
	check('private action saves', privateAction.status === 200 && privateId);
	const bellaPrivate = await runAction(bella.cookie, { action: privateId });
	check('foreign private action is invisible to run', bellaPrivate.status === 404);
	const bellaPublic = await runAction(bella.cookie, { action: createCustomerId, inputs: { name: 'Bella Own' } });
	check('public action runs AS the invoker (their data, their ACL)', bellaPublic.status === 200 && bellaPublic.body?.status === 'ok');

	// ---- scoped read constrains a BARE search (Lopu review finding 1) --------
	const bareSearch = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Scoped bare search',
			actionKey: `bare-search-${suffix}`,
			steps: [
				{ op: 'things.search', limit: 50 },
				{ op: 'return', value: '$step.1' }
			],
			capabilities: [{ capability: 'things.read', schemas: [CUSTOMER_ID] }]
		}
	});
	check('bare search saves under a scoped read (run-time gap scenario)', bareSearch.status === 200);
	const bareRun = await runAction(alice.cookie, { action: `bare-search-${suffix}` });
	const bareResults = Array.isArray(bareRun.body?.result) ? bareRun.body.result : [];
	check(
		'scoped read constrains a bare search to its schemas',
		bareRun.status === 200 &&
			bareRun.body?.status === 'ok' &&
			bareResults.length > 0 &&
			bareResults.every((entry) => entry?.crystal?.schemaId === CUSTOMER_ID || entry?.crystal?.schema === CUSTOMER),
		JSON.stringify(bareResults.map((entry) => entry?.crystal?.schema)).slice(0, 200)
	);

	// ---- update cannot relabel provenance (Lopu review finding 3) ------------
	const relabel = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Relabel attempt',
			actionKey: `relabel-${suffix}`,
			inputs: [{ name: 'id', type: 'string', required: true }],
			steps: [
				{ op: 'things.get', id: '$input.id' },
				{ op: 'things.update', id: '$input.id', values: { status: 'draft', schema: 'not-invoice', schemaId: 'fake-schema-id' } },
				{ op: 'return', value: '$step.2' }
			],
			capabilities: [
				{ capability: 'things.read', schemas: [INVOICE] },
				{ capability: 'things.update', schemas: [INVOICE] }
			]
		}
	});
	check('relabel-attempt action saves', relabel.status === 200);
	const relabelRun = await runAction(alice.cookie, { action: `relabel-${suffix}`, inputs: { id: invoiceId } });
	const relabeled = await api(`/api/v1/things?id=${encodeURIComponent(invoiceId || 'missing')}`, { cookie: alice.cookie });
	const relabeledCrystal = relabeled.body?.thing?.crystal || {};
	check(
		'update re-stamps schema provenance from the current doc',
		relabelRun.status === 200 &&
			relabelRun.body?.status === 'ok' &&
			relabeledCrystal.schema === INVOICE &&
			relabeledCrystal.schemaId !== 'fake-schema-id' &&
			relabeledCrystal.status === 'draft',
		`schema=${relabeledCrystal.schema} schemaId=${String(relabeledCrystal.schemaId).slice(0, 20)}`
	);

	// ---- docs twins ----------------------------------------------------------
	const runDocs = await api('/api/v1/actions/run-docs');
	const runsDocs = await api('/api/v1/actions/runs-docs');
	check('run docs twin serves', runDocs.status === 200 && runDocs.body?.ok === true);
	check('runs docs twin serves', runsDocs.status === 200 && runsDocs.body?.ok === true);

	console.log(`\n${passed} passed, ${failures.length} failed`);
	if (failures.length) {
		console.log(failures.map((name) => `  ✗ ${name}`).join('\n'));
		process.exit(1);
	}
};

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
