/** Small origin-scoped requirement maps. Review values bind the exact runtime
 * contracts; IDs, content hashes and a source backup never grant access. */
export const CONTENT_CREATION_REQUIREMENTS = {
	'api.things': '1.52.0',
	'api.actions-run': '1.43.0',
	'api.timeline': '1.19.2'
} as const;
export const CONTENT_EXECUTION_READ_REQUIREMENTS = {
	'api.things': '1.52.0',
	'api.components-browse': '1.1.0',
	'api.webpages-resolve': '1.13.0'
} as const;
