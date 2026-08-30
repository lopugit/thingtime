#!/usr/bin/env node
// Live verification of the Action Thing family — real API only (FUNDAMENTALS §2).
//   node scripts/verify-actions.mjs [baseUrl]
// Covers: the save-time grammar (closed vocabulary, capability coverage,
// scoped capabilities, ref validity, return placement, limits), the executor
// (create/get/search/update/invoke/return, $refs, $$ escape, ttConcat, $now),
// the budget envelope (ops exhaustion, recursion refusal — direct and A→B→A),
// run records (protected kind, owner-private history, deleted with their
// action), and the auth gates.
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

	// ---- input names that collide with Object.prototype ---------------------
	// Input names are only pattern-checked, so an action may legally declare one
	// called `constructor`/`toString`/`__proto__`. Both halves of $input
	// resolution are hasOwnProperty-gated (execute.ts validateRunInputs +
	// resolveValue), so an OMITTED one reads as undefined — its declared default
	// applies, its "is required" refusal fires — instead of resolving to the
	// inherited member through the caller's JSON object.
	const protoInputs = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Prototype-named inputs',
			actionKey: `proto-inputs-${suffix}`,
			inputs: [
				{ name: 'constructor', type: 'string', default: 'fallback' },
				{ name: 'toString', type: 'string', required: true }
			],
			steps: [
				{ op: 'things.create', schema: CUSTOMER, values: { name: '$input.toString', note: '$input.constructor' } },
				{ op: 'return', value: '$step.1' }
			],
			capabilities: [{ capability: 'things.create', schemas: [CUSTOMER] }]
		}
	});
	check('prototype-named inputs save', protoInputs.status === 200, JSON.stringify(protoInputs.body).slice(0, 200));

	const protoMissing = await runAction(alice.cookie, { action: `proto-inputs-${suffix}`, inputs: {} });
	check(
		'omitted prototype-named required input reports "is required"',
		protoMissing.status === 400 && /toString is required/.test(protoMissing.body?.error || ''),
		JSON.stringify(protoMissing.body).slice(0, 200)
	);

	const protoDefault = await runAction(alice.cookie, { action: `proto-inputs-${suffix}`, inputs: { toString: 'Grace Hopper' } });
	check(
		'omitted prototype-named input falls back to its declared default',
		protoDefault.status === 200 && protoDefault.body?.status === 'ok' && protoDefault.body?.result?.crystal?.note === 'fallback',
		JSON.stringify(protoDefault.body).slice(0, 300)
	);

	// A boolean input named __proto__ can never hold an own key (the assignment
	// hits the accessor and is a silent no-op), so $input.__proto__ must read as
	// undefined — never as Object.prototype leaking into a step value.
	const protoLeak = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Proto leak probe',
			actionKey: `proto-leak-${suffix}`,
			inputs: [{ name: '__proto__', type: 'boolean' }],
			steps: [{ op: 'return', value: '$input.__proto__' }]
		}
	});
	check('__proto__-named input saves', protoLeak.status === 200, JSON.stringify(protoLeak.body).slice(0, 200));
	const protoLeakRun = await runAction(alice.cookie, {
		action: `proto-leak-${suffix}`,
		inputs: JSON.parse('{"__proto__":true}')
	});
	check(
		'$input.__proto__ resolves to nothing, not Object.prototype',
		protoLeakRun.status === 200 && protoLeakRun.body?.status === 'ok' && protoLeakRun.body?.result == null,
		JSON.stringify(protoLeakRun.body).slice(0, 300)
	);

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

	// ---- the trail dies with its action (Lopu review finding) ----------------
	// action-run is PROTECTED (no route lets its owner delete one) and
	// storageClass 'control' (outside the storage ledger), and the retention
	// prune only ever fires during a run OF THAT ACTION. So if deleting an
	// action left its records behind, create/run/delete cycles would strand
	// unaccounted documents that nothing would ever prune — and the owner could
	// never remove their own run history. The cascade closes both.
	const disposable = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: { name: 'Disposable', actionKey: `disposable-${suffix}`, steps: [{ op: 'return', value: 'bye' }] }
	});
	const disposableId = disposable.body?.thing?.id;
	check('disposable action saves', disposable.status === 200 && !!disposableId);
	const disposableRun = await runAction(alice.cookie, { action: disposableId });
	check('disposable action runs', disposableRun.status === 200 && disposableRun.body?.status === 'ok');
	const beforeDelete = await api(`/api/v1/actions/runs?action=${encodeURIComponent(disposableId)}`, { cookie: alice.cookie });
	check('its run is in history before the delete', beforeDelete.status === 200 && (beforeDelete.body?.runs || []).length === 1);
	const deleted = await api(`/api/v1/things?id=${encodeURIComponent(disposableId)}`, { cookie: alice.cookie, method: 'DELETE' });
	check('deleting an action succeeds', deleted.status === 200, `status ${deleted.status} ${JSON.stringify(deleted.body || {}).slice(0, 140)}`);
	const afterDelete = await api(`/api/v1/actions/runs?action=${encodeURIComponent(disposableId)}`, { cookie: alice.cookie });
	check(
		'deleting an action deletes its run records (no stranded trail)',
		afterDelete.status === 200 && (afterDelete.body?.runs || []).length === 0,
		`${(afterDelete.body?.runs || []).length} record(s) survived`
	);
	// the neighbours' trails are untouched — the cascade is scoped to targetId
	const neighbourRuns = await api(`/api/v1/actions/runs?action=${encodeURIComponent(createCustomerId)}`, { cookie: alice.cookie });
	check('another action keeps its own runs', neighbourRuns.status === 200 && (neighbourRuns.body?.runs || []).length > 0);

	// ---- ...including a run that was ALREADY IN FLIGHT (Lopu review finding) --
	// The record is written when the run ENDS, so the cascade — which snapshots
	// the closure before that insert exists — cannot see it. createThing rides
	// out this race by transacting its insert with a touch of the target doc;
	// the run-record insert writes no parent doc, so nothing makes Mongo retry
	// either side and the orphan is permanent (unprunable, undeletable,
	// off-ledger). Delete the action WHILE a run of it is in flight: whichever
	// way the interleaving lands, no record may survive naming a dead action.
	const inFlight = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Deleted mid-run',
			actionKey: `midrun-${suffix}`,
			capabilities: [{ capability: 'things.read' }],
			// several real round trips, so the DELETE below lands before the run
			// reaches writeRunRecord — the window this guard actually closes
			steps: [
				...Array.from({ length: 12 }, () => ({ op: 'things.search', limit: 5 })),
				{ op: 'return', value: 'done' }
			]
		}
	});
	const inFlightId = inFlight.body?.thing?.id;
	check('mid-run-delete action saves', inFlight.status === 200 && !!inFlightId, JSON.stringify(inFlight.body || {}).slice(0, 200));
	// fire the run WITHOUT awaiting, then delete underneath it. The short head
	// start only removes the uninteresting third interleaving (the delete
	// beating resolveActionProgram, which is a plain 404 and strands nothing);
	// both remaining orders must satisfy the assertions below.
	const inFlightRun = runAction(alice.cookie, { action: inFlightId });
	await new Promise((resolve) => setTimeout(resolve, 250));
	let midRunDelete = await api(`/api/v1/things?id=${encodeURIComponent(inFlightId)}`, { cookie: alice.cookie, method: 'DELETE' });
	const runOutcome = await inFlightRun;
	// a cascade that raced a just-committed record answers 409 "try again" —
	// retry so the assertion below tests the trail, not the retry contract
	for (let attempt = 0; attempt < 5 && midRunDelete.status === 409; attempt += 1) {
		midRunDelete = await api(`/api/v1/things?id=${encodeURIComponent(inFlightId)}`, { cookie: alice.cookie, method: 'DELETE' });
	}
	check(
		'the action deletes while one of its runs is still executing',
		midRunDelete.status === 200,
		`status ${midRunDelete.status} ${JSON.stringify(midRunDelete.body || {}).slice(0, 140)}`
	);
	check('the in-flight run still returns its own result to the caller', runOutcome.status === 200 && !!runOutcome.body?.runId);
	const strandedByAction = await api(`/api/v1/actions/runs?action=${encodeURIComponent(inFlightId)}`, { cookie: alice.cookie });
	check(
		'a run that finished after its action was deleted leaves no record',
		strandedByAction.status === 200 && (strandedByAction.body?.runs || []).length === 0,
		`${(strandedByAction.body?.runs || []).length} record(s) survived`
	);
	// and it is gone from the UNFILTERED history too — that view is the only
	// place an orphan would still surface, and nothing could ever remove it
	const wholeHistory = await api(`/api/v1/actions/runs?limit=50`, { cookie: alice.cookie });
	check(
		'no orphan survives in the unfiltered run history either',
		wholeHistory.status === 200 && !(wholeHistory.body?.runs || []).some((record) => record?.actionId === inFlightId),
		JSON.stringify((wholeHistory.body?.runs || []).filter((record) => record?.actionId === inFlightId)).slice(0, 140)
	);

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

	// ---- data-ops are Data-Things-only (kind boundary) ----------------------
	// An unscoped things.update/things.read declares no schema, so the schema
	// check can't hold the line for a target that carries no schema. The run
	// must still refuse a non-data kind (here a schema thing and an action
	// thing the invoker owns), matching things.create/things.search which
	// already pin `data`. Both actions SAVE (grammar can't resolve a dynamic
	// id) and refuse at run time.
	const updKind = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Update non-data kind',
			actionKey: `upd-kind-${suffix}`,
			steps: [
				{ op: 'things.update', id: CUSTOMER_ID, values: { hijacked: true } },
				{ op: 'return', value: '$step.1' }
			],
			capabilities: [{ capability: 'things.update' }]
		}
	});
	check('unscoped-update action saves (kind gap scenario)', updKind.status === 200);
	const updKindRun = await runAction(alice.cookie, { action: `upd-kind-${suffix}` });
	check(
		'unscoped things.update refuses a non-data target kind (Data Things only)',
		updKindRun.status === 200 && updKindRun.body?.status === 'error' && /not a data thing/.test(updKindRun.body?.error || ''),
		JSON.stringify({ status: updKindRun.body?.status, error: updKindRun.body?.error }).slice(0, 200)
	);
	const schemaAfter = await api(`/api/v1/things?id=${encodeURIComponent(CUSTOMER_ID || 'missing')}`, { cookie: alice.cookie });
	check('the non-data target was left unchanged', schemaAfter.body?.thing?.crystal?.hijacked === undefined);

	const getKind = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Read non-data kind',
			actionKey: `get-kind-${suffix}`,
			steps: [
				{ op: 'things.get', id: createCustomerId },
				{ op: 'return', value: '$step.1' }
			],
			capabilities: [{ capability: 'things.read' }]
		}
	});
	check('unscoped-read action saves (kind gap scenario)', getKind.status === 200);
	const getKindRun = await runAction(alice.cookie, { action: `get-kind-${suffix}` });
	check(
		'unscoped things.get refuses a non-data target kind (Data Things only)',
		getKindRun.status === 200 && getKindRun.body?.status === 'error' && /not a data thing/.test(getKindRun.body?.error || ''),
		JSON.stringify({ status: getKindRun.body?.status, error: getKindRun.body?.error }).slice(0, 200)
	);

	// ---- parameterless (PURE) actions — the Lopu round-3 crash class ---------
	const pure = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: { name: 'Pure pong', actionKey: `pure-${suffix}`, steps: [{ op: 'return', value: 'pong' }] }
	});
	check('a parameterless action saves (inputs omitted, not [])', pure.status === 200 && pure.body?.thing?.crystal?.inputs === undefined);
	const pureRun = await runAction(alice.cookie, { action: `pure-${suffix}` });
	check(
		'a parameterless PURE action runs: 0 ops, return is free',
		pureRun.status === 200 && pureRun.body?.status === 'ok' && pureRun.body?.result === 'pong' && pureRun.body?.opsUsed === 0
	);

	// ---- duplicate actionKey resolution (latest revision wins) ---------------
	// Nothing index-enforces per-owner actionKey uniqueness yet, so a key-
	// referenced run must resolve deterministically: highest crystal.version
	// (the schema's revision counter), not Mongo natural order. v1 is created
	// FIRST so a natural-order findOne would wrongly pick it.
	const dupKey = `dup-${suffix}`;
	const dupV1 = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: { name: 'Dup v1', actionKey: dupKey, version: 1, steps: [{ op: 'return', value: 'first revision' }] }
	});
	const dupV2 = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: { name: 'Dup v2', actionKey: dupKey, version: 2, steps: [{ op: 'return', value: 'second revision' }] }
	});
	check('two revisions can share an actionKey', dupV1.status === 200 && dupV2.status === 200);
	const dupRun = await runAction(alice.cookie, { action: dupKey });
	check(
		'a key-referenced run resolves the LATEST revision (highest version)',
		dupRun.status === 200 && dupRun.body?.status === 'ok' && dupRun.body?.result === 'second revision',
		JSON.stringify(dupRun.body || {}).slice(0, 160)
	);

	// ---- SECURITY REGRESSIONS (2026-08-25 review) ---------------------------
	// R1 — action-created things must be PRIVATE. createThing's standalone
	// default is the public audience; an action minting on the invoker's behalf
	// must never widen the audience of data it copies from a read.
	const secAudienceAction = await createThing(alice.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Audience check',
			actionKey: `audience-${suffix}`,
			inputs: [{ name: 'name', type: 'string', required: true }],
			steps: [
				{ op: 'things.create', schema: CUSTOMER_ID, values: { name: '$input.name' } },
				{ op: 'return', value: '$step.1' }
			],
			capabilities: [{ capability: 'things.create', schemas: [CUSTOMER_ID] }]
		}
	});
	check('audience-check action saves', secAudienceAction.status === 200);
	const secMintedRun = await runAction(alice.cookie, { action: `audience-${suffix}`, inputs: { name: 'Audience Probe' } });
	check('audience-check action runs', secMintedRun.status === 200 && secMintedRun.body?.status === 'ok', JSON.stringify(secMintedRun.body || {}).slice(0, 200));
	const secMintedId = secMintedRun.body?.result?.id;
	const secMintedOwnerRead = await api(`/api/v1/things?id=${encodeURIComponent(secMintedId || '')}`, { cookie: alice.cookie });
	check(
		'an action-created thing is minted PRIVATE (acl tt:user, not tt:all)',
		Array.isArray(secMintedOwnerRead.body?.thing?.acl) &&
			secMintedOwnerRead.body.thing.acl.includes('tt:user') &&
			!secMintedOwnerRead.body.thing.acl.includes('tt:all'),
		JSON.stringify(secMintedOwnerRead.body?.thing?.acl || null)
	);
	const secMintedStrangerRead = await api(`/api/v1/things?id=${encodeURIComponent(secMintedId || '')}`, { cookie: bella.cookie });
	check(
		'a second user cannot read an action-created thing',
		secMintedStrangerRead.status === 404 || secMintedStrangerRead.body?.ok === false,
		`status ${secMintedStrangerRead.status}`
	);
	const secMintedAnonRead = await api(`/api/v1/things?id=${encodeURIComponent(secMintedId || '')}`);
	check(
		'an anonymous reader cannot read an action-created thing',
		secMintedAnonRead.status === 404 || secMintedAnonRead.body?.ok === false,
		`status ${secMintedAnonRead.status}`
	);

	// R2 — a component click (source: 'component') resolves ONLY actions the
	// invoker owns, so foreign markup cannot lend the viewer's authority to a
	// stranger's program. The secDeliberateRun inspector path still resolves it.
	const secForeignAction = await createThing(bella.cookie, {
		thingtime: ['action'],
		crystal: {
			name: 'Bella public probe',
			actionKey: `bella-pub-${suffix}`,
			steps: [{ op: 'return', value: 'bella-ran' }]
		},
		acl: ['tt:all']
	});
	check('a public foreign action exists', secForeignAction.status === 200, JSON.stringify(secForeignAction.body || {}).slice(0, 160));
	const secForeignId = secForeignAction.body?.thing?.id;
	const secDelegatedRun = await runAction(alice.cookie, { action: secForeignId, source: 'component' });
	check(
		'a component click REFUSES a foreign action by id (delegated path is owner-scoped)',
		secDelegatedRun.status === 404,
		`status ${secDelegatedRun.status} ${JSON.stringify(secDelegatedRun.body || {}).slice(0, 140)}`
	);
	const secDeliberateRun = await runAction(alice.cookie, { action: secForeignId });
	check(
		'the deliberate inspector path still runs a readable foreign action',
		secDeliberateRun.status === 200 && secDeliberateRun.body?.result === 'bella-ran',
		`status ${secDeliberateRun.status}`
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
