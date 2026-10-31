import { SERVICE_LABELS, SERVICE_ROLES, type ServiceRecord } from '~/schemas/serviceWorkspace';
import type { CollectionFilter } from '~/components/Collections/CollectionList';

export function serviceListFilters(items: ServiceRecord[], team: { id: string; name: string }[] = []): CollectionFilter<ServiceRecord>[] {
	const kinds = new Set(items.map((item) => item.kind));
	const filters: CollectionFilter<ServiceRecord>[] = [];
	if (kinds.size > 1) filters.push({ key: 'kind', label: 'Type', value: (item) => SERVICE_LABELS[item.kind] });
	if (kinds.has('visit'))
		filters.push({
			key: 'status',
			label: 'Status',
			value: (item) => item.values.status || 'Scheduled',
			options: ['Scheduled', 'In progress', 'Completed', 'Cancelled'].map((value) => ({ value, label: value }))
		});
	if (kinds.has('equipment')) filters.push({ key: 'category', label: 'Category', value: (item) => item.values.category || 'Other' });
	if (kinds.has('member'))
		filters.push({
			key: 'role',
			label: 'Role',
			value: (item) => item.values.role || '',
			options: SERVICE_ROLES.map((value) => ({ value, label: value }))
		});
	if (['visit', 'time', 'usage'].some((kind) => kinds.has(kind as ServiceRecord['kind'])))
		filters.push({
			key: 'employee',
			label: 'Employee',
			value: (item) => item.values.employeeId || '__unassigned__',
			options: [{ value: '__unassigned__', label: 'Unassigned' }, ...team.map((member) => ({ value: member.id, label: member.name }))]
		});
	return filters;
}
