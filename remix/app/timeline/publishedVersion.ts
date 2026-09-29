import { copyBoundedJson } from '../utils/boundedJson.ts';
import { componentBindingSnapshot, webpageComponentRefs } from './componentBindings.ts';
import { componentBlocks } from './componentMerge.ts';
import { componentValues, definitionSnapshot, type ComponentDefinitionVersion } from './componentDefinitions.ts';
import { type TimelineSnapshot } from './contract.ts';
import { versionContent, type VersionChoices, type VersionConflict } from './versions.ts';

/** Three independently bounded content snapshots plus component comparison. */
export const PUBLISHED_PREVIEW_MAX_BYTES = 16 * 1024 * 1024;
export type VersionRequest = {
	command: 'preview-version' | 'apply-version';
	mode: 'restore' | 'merge';
	eventId: string;
	expectedHeadId?: string;
	operationId?: string;
	choices?: VersionChoices;
	componentMode?: 'recorded' | 'current';
	componentChoices?: VersionChoices;
	expectedComponents?: string;
};
export type PublishedComponents = {
	current: ComponentDefinitionVersion;
	incoming: ComponentDefinitionVersion;
	result: ComponentDefinitionVersion;
	conflicts: VersionConflict[];
	missing: string[];
	unavailable: string[];
	copyCount: number;
	fingerprint: string;
};
export type PublishedVersionPreview = {
	eventId: string;
	thingId: string;
	mode: VersionRequest['mode'];
	expectedHeadId: string;
	current: TimelineSnapshot;
	incoming: TimelineSnapshot;
	result: TimelineSnapshot;
	baseEventId: string | null;
	conflicts: VersionConflict[];
	thingtime?: string[];
	components?: PublishedComponents;
};
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const keys = (value: unknown, expected: string[]) =>
	object(value) && Object.keys(value).length === expected.length && expected.every((key) => own(value, key));
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const choices = (value: unknown) => object(value) && Object.values(value).every((choice) => choice === 'current' || choice === 'incoming');
export function parseVersionRequest(input: unknown): VersionRequest {
	const value = copyBoundedJson(input, { maxBytes: 64 * 1024, maxDepth: 5, maxNodes: 2000, sortKeys: true }, 'Version request') as any;
	if (
		!object(value) ||
		Object.keys(value).some(
			(key) =>
				![
					'command',
					'mode',
					'eventId',
					'expectedHeadId',
					'operationId',
					'choices',
					'componentMode',
					'componentChoices',
					'expectedComponents'
				].includes(key)
		) ||
		!['preview-version', 'apply-version'].includes(value.command) ||
		!['restore', 'merge'].includes(value.mode) ||
		!id(value.eventId)
	)
		throw new Error('Invalid version request.');
	if (value.command === 'apply-version' && (!id(value.expectedHeadId) || !uuid(value.operationId)))
		throw new Error('Applying a version requires its preview head and a UUID operation id.');
	if (value.choices !== undefined && !choices(value.choices)) throw new Error('Invalid version choices.');
	if (value.componentMode !== undefined && !['recorded', 'current'].includes(value.componentMode)) throw new Error('Invalid component mode.');
	if (
		value.componentChoices !== undefined &&
		(!value.componentMode || !choices(value.componentChoices) || Object.keys(value.componentChoices).length > 120)
	)
		throw new Error('Invalid component choices.');
	if (value.expectedComponents !== undefined && (!value.componentMode || !digest(value.expectedComponents)))
		throw new Error('Invalid component preview identity.');
	if (value.command === 'apply-version' && value.componentMode && !digest(value.expectedComponents))
		throw new Error('Review the components before applying this version.');
	if (value.componentMode === 'current' && Object.keys(value.componentChoices ?? {}).length)
		throw new Error('Current components do not accept recorded choices.');
	return value as VersionRequest;
}
function checkConflicts(value: unknown) {
	if (!Array.isArray(value) || value.length > 2000) throw new Error('Invalid version conflicts.');
	const seen = new Set<string>();
	for (const conflict of value) {
		if (
			!keys(conflict, ['path', 'base', 'current', 'incoming']) ||
			!Array.isArray(conflict.path) ||
			conflict.path.length > 96 ||
			conflict.path.some((part: unknown) => typeof part !== 'string')
		)
			throw new Error('Invalid version conflict.');
		const key = JSON.stringify(conflict.path);
		if (seen.has(key)) throw new Error('Duplicate version conflict.');
		seen.add(key);
		for (const side of ['base', 'current', 'incoming']) {
			const field = conflict[side];
			if (!object(field) || (field.present === true ? !keys(field, ['present', 'value']) : field.present !== false || !keys(field, ['present'])))
				throw new Error('Invalid version conflict value.');
		}
	}
}
export function parsePublishedVersionPreview(input: unknown, eventId: string, thingId: string, request: VersionRequest): PublishedVersionPreview {
	const value = copyBoundedJson(
		input,
		{ maxBytes: PUBLISHED_PREVIEW_MAX_BYTES, maxDepth: 100, maxNodes: 800_000, sortKeys: true },
		'Version preview'
	) as any;
	if (
		!keys(value, [
			'eventId',
			'thingId',
			'mode',
			'expectedHeadId',
			'current',
			'incoming',
			'result',
			'baseEventId',
			'conflicts',
			...(request.componentMode ? ['thingtime', 'components'] : [])
		]) ||
		value.eventId !== eventId ||
		value.thingId !== thingId ||
		value.mode !== request.mode ||
		!id(value.expectedHeadId) ||
		(value.baseEventId !== null && !id(value.baseEventId))
	)
		throw new Error('This comparison belongs to another version.');
	for (const side of ['current', 'incoming', 'result']) {
		if (
			!keys(value[side], ['adapter', 'version', 'value']) ||
			value[side].adapter !== 'thing-content' ||
			value[side].version !== 1 ||
			!keys(value[side].value, ['crystal', 'extended', 'tags', 'geo', 'acl', 'folderId'])
		)
			throw new Error('Invalid version content.');
		versionContent(value[side]);
	}
	checkConflicts(value.conflicts);
	if (request.componentMode) {
		if (
			!Array.isArray(value.thingtime) ||
			!value.thingtime.length ||
			value.thingtime.length > 32 ||
			value.thingtime.some((kind: unknown) => typeof kind !== 'string' || !kind || kind.length > 100)
		)
			throw new Error('Invalid version schemas.');
		const isPage = value.thingtime.includes('webpage');
		const component = value.components;
		if (
			!keys(component, ['current', 'incoming', 'result', 'conflicts', 'missing', 'unavailable', 'copyCount', 'fingerprint']) ||
			!digest(component.fingerprint) ||
			!Number.isSafeInteger(component.copyCount) ||
			component.copyCount < 0 ||
			component.copyCount > 120
		)
			throw new Error('Invalid component preview.');
		for (const side of ['current', 'incoming', 'result']) {
			const entries = component[side];
			if (
				!object(entries) ||
				JSON.stringify(Object.keys(entries).sort()) !== JSON.stringify((isPage ? webpageComponentRefs(componentBlocks(value[side])) : []).sort())
			)
				throw new Error('Components belong to another page.');
			for (const [ref, field] of Object.entries(entries) as [string, any][]) {
				if (!object(field) || (field.present === true ? !keys(field, ['present', 'value']) : field.present !== false || !keys(field, ['present'])))
					throw new Error('Invalid component definition.');
				if (field.present && JSON.stringify(componentBindingSnapshot(ref, field.value).value) !== JSON.stringify({ component: field.value, ref }))
					throw new Error('Invalid component definition projection.');
			}
			definitionSnapshot(componentValues(entries));
		}
		checkConflicts(component.conflicts);
		const missing = Object.entries(component.result)
			.filter(([, field]: any) => !field.present)
			.map(([ref]) => ref)
			.sort();
		const unavailable = Object.entries(component.result)
			.filter(([, field]: any) => field.present && field.value === null)
			.map(([ref]) => ref)
			.sort();
		if (JSON.stringify(component.missing) !== JSON.stringify(missing) || JSON.stringify(component.unavailable) !== JSON.stringify(unavailable))
			throw new Error('Invalid component availability.');
	}
	return value;
}
