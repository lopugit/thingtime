import { AsyncLocalStorage } from 'node:async_hooks';

// Opt-in only: one remaining budget follows collection operations across auth,
// limiter and content reads. Driver timeoutMS covers selection/pool/socket work;
// the signal also cancels supported reads when the HTTP caller disconnects.
type Budget = { signal: AbortSignal; deadline: number };
const budgets = new AsyncLocalStorage<Budget>();

export const withMongoRequestBudget = async <T>(signal: AbortSignal, timeoutMs: number, work: () => Promise<T>): Promise<T> => {
	const controller = new AbortController();
	const abort = () => controller.abort(signal.reason);
	if (signal.aborted) abort();
	else signal.addEventListener('abort', abort, { once: true });
	const timer = setTimeout(() => controller.abort(new DOMException('Request deadline exceeded', 'TimeoutError')), timeoutMs);
	try { return await budgets.run({ signal: controller.signal, deadline: Date.now() + timeoutMs }, work); }
	finally { controller.abort(); clearTimeout(timer); signal.removeEventListener('abort', abort); }
};

export const mongoRequestOptions = <T extends Record<string, any>>(options: T = {} as T): T & { timeoutMS?: number; signal?: AbortSignal } => {
	const budget = budgets.getStore();
	if (!budget) return options;
	budget.signal.throwIfAborted();
	const remaining = budget.deadline - Date.now();
	if (remaining <= 0) throw new DOMException('Request deadline exceeded', 'TimeoutError');
	return { ...options, timeoutMS: Math.max(1, Math.min(remaining, options.timeoutMS || remaining)), signal: options.signal && options.signal !== budget.signal ? AbortSignal.any([options.signal, budget.signal]) : budget.signal };
};

// Start shared initialization outside only this request's budget. Other ALS
// scopes (gateway admission, data-plane selection and recovery authority) stay
// intact. The initializer keeps its existing independent driver/lease bounds.
export const startMongoSharedWork = <T>(work: () => Promise<T>): Promise<T> => budgets.exit(work);

// Only shared initialization/readiness work may outlive a waiter. Never use
// this to abandon per-request operations: those receive driver deadlines.
export const awaitMongoSharedWork = async <T>(work: Promise<T>): Promise<T> => {
	const budget = budgets.getStore();
	if (!budget) return work;
	budget.signal.throwIfAborted();
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(budget.signal.reason);
		budget.signal.addEventListener('abort', abort, { once: true });
		work.then(resolve, reject).finally(() => budget.signal.removeEventListener('abort', abort));
	});
};

const OPTION_INDEX: Record<string, number> = {
	findOne: 1, find: 1, aggregate: 1, countDocuments: 1, estimatedDocumentCount: 0, distinct: 2,
	updateOne: 2, updateMany: 2, replaceOne: 2, findOneAndUpdate: 2, findOneAndReplace: 2,
	findOneAndDelete: 1, insertOne: 1, insertMany: 1, deleteOne: 1, deleteMany: 1, bulkWrite: 1
};
export const budgetMongoArguments = (method: string, args: any[]): any[] => {
	if (!budgets.getStore() || !Object.prototype.hasOwnProperty.call(OPTION_INDEX, method)) return args;
	const result = [...args];
	const index = OPTION_INDEX[method];
	result[index] = mongoRequestOptions(result[index]);
	// A convenient transaction owns its CSOT deadline; Mongo rejects per-op
	// timeout overrides on that explicit session. The transaction carries the
	// remaining request budget, while supported reads still get cancellation.
	if (result[index]?.session?.inTransaction?.()) delete result[index].timeoutMS;
	return result;
};

export const mongoTransactionBudget = () => {
	const { timeoutMS } = mongoRequestOptions();
	return timeoutMS ? { timeoutMS, maxCommitTimeMS: timeoutMS } : {};
};
