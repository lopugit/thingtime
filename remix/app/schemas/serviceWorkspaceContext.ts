import { serviceTitle, type ServiceRecord } from './serviceWorkspace';

export type ServiceJobContextData = { property: string; customers: string[]; crew: string[]; assigned: boolean };

// Resolve only the records and staff names already authorized in this snapshot.
// Index relations once so a full planner does not rescan the workspace per card.
export function serviceWorkspaceContexts(records: ServiceRecord[], team: { id: string; name: string }[] = []) {
	const byId = new Map(records.map((record) => [record.id, record]));
	const names = new Map(team.map((member) => [member.id, member.name]));
	const customersByAddress = new Map<string, Set<string>>();
	const crewByJob = new Map<string, Set<string>>();
	for (const record of records) {
		if (record.values.archived) continue;
		if (record.kind === 'link') {
			const customer = byId.get(record.values.customerId);
			if (customer?.kind !== 'customer' || customer.values.archived) continue;
			const customers = customersByAddress.get(record.values.addressId) || new Set<string>();
			customers.add(customer.id);
			customersByAddress.set(record.values.addressId, customers);
		}
		if (record.kind === 'visit' && record.values.employeeId && record.values.status !== 'Cancelled') {
			const crew = crewByJob.get(record.values.jobId) || new Set<string>();
			crew.add(record.values.employeeId);
			crewByJob.set(record.values.jobId, crew);
		}
	}
	const contexts = new Map<string, ServiceJobContextData>();
	for (const record of records) {
		if (record.kind !== 'job' && record.kind !== 'visit') continue;
		const job = record.kind === 'job' ? record : byId.get(record.values.jobId);
		const address = job?.kind === 'job' ? byId.get(job.values.addressId) : undefined;
		const property =
			address?.kind === 'address'
				? [...new Set([serviceTitle(address), address.values.address].filter(Boolean))].join(' · ')
				: 'Property unavailable';
		const crewIds =
			record.kind === 'visit'
				? new Set<string>(record.values.employeeId ? [record.values.employeeId] : [])
				: crewByJob.get(record.id) || new Set<string>();
		contexts.set(record.id, {
			property,
			customers: [...(customersByAddress.get(address?.id || '') || [])].map((id) => serviceTitle(byId.get(id)!)),
			crew: [...crewIds].flatMap((id) => (names.has(id) ? [names.get(id)!] : [])),
			assigned: crewIds.size > 0
		});
	}
	return contexts;
}

export const serviceContextText = (context?: ServiceJobContextData) =>
	context ? [context.property, ...context.customers, ...context.crew].join(' ') : '';
