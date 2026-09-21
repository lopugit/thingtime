// Shared, closed contract for the builder's service-workspace native component.
// Records stay ordinary, individually editable Things; growing lists are children.
export const SERVICE_WORKSPACE_VERSION = 1;
export const SERVICE_WORKSPACE_ACL = 'tt:service-workspace';
export const SERVICE_ROLES = ['Admin', 'Employee', 'Lopu', 'Customer', 'B2B'] as const;
export type ServiceRole = (typeof SERVICE_ROLES)[number];
export const SERVICE_KINDS = ['customer', 'address', 'job', 'visit', 'equipment', 'link', 'subjob', 'time', 'usage', 'member'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export type ServiceField = {
	key: string;
	label: string;
	type?: 'text' | 'textarea' | 'email' | 'tel' | 'number' | 'date' | 'time' | 'datetime-local' | 'select' | 'reference';
	required?: boolean;
	options?: readonly string[];
	ref?: ServiceKind;
	min?: number;
	max?: number;
};
export const SERVICE_FIELDS: Record<ServiceKind, ServiceField[]> = {
	customer: [
		{ key: 'firstName', label: 'First name', required: true },
		{ key: 'lastName', label: 'Last name' },
		{ key: 'contact', label: 'Contact / company' },
		{ key: 'phone', label: 'Phone', type: 'tel' },
		{ key: 'email', label: 'Email', type: 'email' },
		{ key: 'description', label: 'Notes', type: 'textarea' }
	],
	address: [
		{ key: 'title', label: 'Nickname', required: true },
		{ key: 'address', label: 'Street address', required: true },
		{ key: 'description', label: 'Property description & access notes', type: 'textarea' }
	],
	job: [
		{ key: 'title', label: 'Job title', required: true },
		{ key: 'addressId', label: 'Address', type: 'reference', ref: 'address', required: true },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'estimatedMinutes', label: 'Estimated total minutes', type: 'number', min: 0, max: 14400 }
	],
	visit: [
		{ key: 'title', label: 'Visit title', required: true },
		{ key: 'jobId', label: 'Job template', type: 'reference', ref: 'job', required: true },
		{ key: 'date', label: 'Date', type: 'date', required: true },
		{ key: 'time', label: 'Start time', type: 'time' },
		{ key: 'status', label: 'Status', type: 'select', options: ['Scheduled', 'In progress', 'Completed', 'Cancelled'] },
		{ key: 'employeeId', label: 'Assigned employee', type: 'reference', ref: 'member' },
		{ key: 'description', label: 'Visit notes', type: 'textarea' }
	],
	equipment: [
		{ key: 'title', label: 'Equipment name', required: true },
		{ key: 'category', label: 'Category', type: 'select', options: ['Tool', 'Battery', 'Vehicle', 'Fuel', 'Other'] },
		{ key: 'serialNumber', label: 'Serial / registration' },
		{ key: 'description', label: 'Description & maintenance notes', type: 'textarea' }
	],
	link: [
		{ key: 'customerId', label: 'Customer', type: 'reference', ref: 'customer', required: true },
		{ key: 'addressId', label: 'Address', type: 'reference', ref: 'address', required: true }
	],
	subjob: [
		{ key: 'jobId', label: 'Job', type: 'reference', ref: 'job', required: true },
		{ key: 'title', label: 'Sub-job', required: true },
		{ key: 'estimatedMinutes', label: 'Estimated minutes', type: 'number', min: 0, max: 14400 }
	],
	time: [
		{ key: 'visitId', label: 'Visit', type: 'reference', ref: 'visit', required: true },
		{ key: 'subjobId', label: 'Sub-job (optional)', type: 'reference', ref: 'subjob' },
		{ key: 'employeeId', label: 'Employee', type: 'reference', ref: 'member' },
		{ key: 'title', label: 'Work performed', required: true },
		{ key: 'from', label: 'From', type: 'datetime-local' },
		{ key: 'to', label: 'To', type: 'datetime-local' },
		{ key: 'minutes', label: 'Minutes (or calculate from times)', type: 'number', min: 0, max: 14400 }
	],
	usage: [
		{ key: 'visitId', label: 'Visit', type: 'reference', ref: 'visit', required: true },
		{ key: 'equipmentId', label: 'Tool / equipment', type: 'reference', ref: 'equipment', required: true },
		{ key: 'employeeId', label: 'Used by', type: 'reference', ref: 'member' },
		{ key: 'batteryId', label: 'Battery', type: 'reference', ref: 'equipment' },
		{ key: 'batteryPercent', label: 'Battery used (%)', type: 'number', min: 0, max: 100 },
		{ key: 'vehicleId', label: 'Vehicle', type: 'reference', ref: 'equipment' },
		{ key: 'fuelLitres', label: 'Fuel used (litres)', type: 'number', min: 0, max: 10000 },
		{ key: 'travelFrom', label: 'Travel from', type: 'datetime-local' },
		{ key: 'travelTo', label: 'Travel to', type: 'datetime-local' },
		{ key: 'kilometres', label: 'Travel (km)', type: 'number', min: 0, max: 100000 },
		{ key: 'description', label: 'Notes', type: 'textarea' }
	],
	member: [
		{ key: 'username', label: 'Thingtime username', required: true },
		{ key: 'role', label: 'Role', type: 'select', options: SERVICE_ROLES, required: true },
		{ key: 'customerId', label: 'Customer / business account', type: 'reference', ref: 'customer' }
	]
};
export const SERVICE_LABELS: Record<ServiceKind, string> = {
	customer: 'Customers',
	address: 'Addresses',
	job: 'Jobs',
	visit: 'Visits',
	equipment: 'Equipment',
	link: 'Customer address links',
	subjob: 'Sub-jobs',
	time: 'Time logs',
	usage: 'Resource usage',
	member: 'Team & access'
};
export const SERVICE_SINGULAR: Record<ServiceKind, string> = {
	customer: 'customer',
	address: 'property',
	job: 'job',
	visit: 'visit',
	equipment: 'equipment',
	link: 'customer link',
	subjob: 'sub-job',
	time: 'time log',
	usage: 'resource log',
	member: 'team member'
};
export type ServiceRecord = { id: string; kind: ServiceKind; values: Record<string, any>; updatedAt: string; folderId?: string | null };
export type ServiceWorkspaceConfig = {
	version: 1;
	name: string;
	timeZone: string;
	folders: Record<ServiceKind, string>;
	pageId?: string;
	mapsEnvironmentId?: string | null;
};
export const isServiceKind = (value: unknown): value is ServiceKind =>
	typeof value === 'string' && (SERVICE_KINDS as readonly string[]).includes(value);
export const isServiceRole = (value: unknown): value is ServiceRole =>
	typeof value === 'string' && (SERVICE_ROLES as readonly string[]).includes(value);
export const isServiceStaff = (role: ServiceRole | null): boolean => role === 'Admin' || role === 'Employee' || role === 'Lopu';
export const serviceTitle = (record: ServiceRecord): string =>
	String(
		record.values.title ||
			[record.values.firstName, record.values.lastName].filter(Boolean).join(' ') ||
			record.values.username ||
			record.values.address ||
			SERVICE_LABELS[record.kind]
	);

export function validateServiceValues(kind: ServiceKind, input: unknown, timeZone = 'UTC'): Record<string, any> {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Record fields must be an object');
	const source = input as Record<string, unknown>;
	const values: Record<string, any> = {};
	for (const field of SERVICE_FIELDS[kind]) {
		const raw = source[field.key];
		if (raw === undefined || raw === null || raw === '') {
			if (field.required) throw new Error(`${field.label} is required`);
			values[field.key] = '';
			continue;
		}
		if (field.type === 'number') {
			if (typeof raw !== 'number' && typeof raw !== 'string') throw new Error(`${field.label} must be a number`);
			const n = Number(raw);
			if (!Number.isFinite(n) || n < (field.min ?? 0) || n > (field.max ?? 100000)) throw new Error(`${field.label} is out of range`);
			values[field.key] = n;
		} else {
			if (typeof raw !== 'string') throw new Error(`${field.label} must be text`);
			const text = raw.trim();
			if (text.length > (field.type === 'textarea' ? 10000 : 500)) throw new Error(`${field.label} is too long`);
			if (field.required && !text) throw new Error(`${field.label} is required`);
			if (field.options && !field.options.includes(text)) throw new Error(`Choose a valid ${field.label.toLowerCase()}`);
			if (field.type === 'date' && !validServiceDate(text)) throw new Error('Choose a valid date');
			if (field.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error('Choose a valid time');
			if (
				field.type === 'datetime-local' &&
				(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(text) || !validServiceDate(text.slice(0, 10)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(text.slice(11)))
			)
				throw new Error('Choose a valid date and time');
			if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new Error('Enter a valid email address');
			values[field.key] = text;
		}
	}
	for (const field of ['thumbnailId', 'bannerId', 'placeId']) {
		if (source[field] !== undefined) {
			if (typeof source[field] !== 'string' || (source[field] as string).length > 300) throw new Error(`Invalid ${field}`);
			values[field] = source[field];
		}
	}
	if (kind === 'member' && ['Customer', 'B2B'].includes(values.role) && !values.customerId)
		throw new Error('Customer and B2B users need a linked customer account');
	if (kind === 'time') {
		if (!!values.from !== !!values.to) throw new Error('Enter both start and end times');
		if (values.from && values.to) {
			const duration = (serviceLocalTimestamp(values.to, timeZone) - serviceLocalTimestamp(values.from, timeZone)) / 60000;
			if (duration <= 0 || duration > 14400) throw new Error('End time must follow start time (maximum 10 days)');
			values.minutes = duration;
		}
		if (!(values.minutes > 0)) throw new Error('Enter minutes or a valid start and end time');
	}
	if (kind === 'usage') {
		if (!!values.travelFrom !== !!values.travelTo) throw new Error('Enter both travel start and end times');
		if (values.travelFrom && values.travelTo && values.travelTo <= values.travelFrom) throw new Error('Travel end must follow travel start');
	}
	return values;
}
export function validServiceDate(value: string): boolean {
	if (!/^\d{4}-\d\d-\d\d$/.test(value)) return false;
	const date = new Date(value + 'T12:00:00Z');
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function serviceDateOffset(date: string, days: number): string {
	const result = new Date(date + 'T12:00:00Z');
	result.setUTCDate(result.getUTCDate() + days);
	return result.toISOString().slice(0, 10);
}
export function serviceWeekStart(date: string): string {
	const day = new Date(date + 'T12:00:00Z').getUTCDay();
	return serviceDateOffset(date, -(day === 0 ? 6 : day - 1));
}
export function serviceVisibleIds(records: ServiceRecord[], role: ServiceRole | null, customerId?: string): Set<string> {
	if (isServiceStaff(role)) return new Set(records.filter((r) => role === 'Admin' || r.kind !== 'member').map((r) => r.id));
	if (!role || !customerId || !records.some((r) => r.kind === 'customer' && r.id === customerId)) return new Set();
	const visibleAddresses = new Set(records.filter((r) => r.kind === 'address').map((r) => r.id));
	const addresses = new Set(
		records
			.filter((r) => r.kind === 'link' && r.values.customerId === customerId && !r.values.archived && visibleAddresses.has(r.values.addressId))
			.map((r) => r.values.addressId)
	);
	const jobs = new Set(records.filter((r) => r.kind === 'job' && addresses.has(r.values.addressId)).map((r) => r.id));
	return new Set(
		records
			.filter(
				(r) =>
					(r.kind === 'customer' && r.id === customerId) ||
					(r.kind === 'address' && addresses.has(r.id)) ||
					(r.kind === 'job' && jobs.has(r.id)) ||
					(r.kind === 'visit' && jobs.has(r.values.jobId)) ||
					(r.kind === 'link' && r.values.customerId === customerId)
			)
			.map((r) => r.id)
	);
}

// Resolve wall-clock input with the workspace's IANA zone. Reject clock-change
// gaps/ambiguities so logged durations cannot silently gain or lose an hour.
export function serviceLocalTimestamp(value: string, timeZone: string): number {
	const naive = Date.parse(value + ':00Z');
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});
	const local = (time: number) => {
		const parts = Object.fromEntries(formatter.formatToParts(time).map((p) => [p.type, p.value]));
		return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
	};
	const offsets = new Set([-86400000, 0, 86400000].map((delta) => Date.parse(local(naive + delta) + ':00Z') - (naive + delta)));
	const candidates = [...offsets].map((offset) => naive - offset).filter((time) => local(time) === value);
	if (candidates.length !== 1) throw new Error('This time falls in a daylight-saving clock change. Enter minutes without start/end times instead.');
	return candidates[0];
}
