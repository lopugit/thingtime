export function backupThemeFixtures(ownerId: string) {
	const common = { ownerId, thingtime: ['theme'], secure: 'NEVER_EXPORT', linkKey: 'NEVER_EXPORT', tokenAcl: 'NEVER_EXPORT' };
	return [
		{
			...common,
			shareId: 'theme-partial',
			timelineHeadId: 'theme-revision-1',
			folderId: 'folder-themes',
			acl: ['tt:all'],
			tags: ['personal'],
			crystal: {
				name: 'Partial theme',
				title: null,
				theme: { colors: { accent: '#eaeaea', unknownPrivateField: 'NEVER_EXPORT' }, general: { motion: false, radiusScale: 0 } },
				privateField: 'NEVER_EXPORT'
			}
		},
		{
			...common,
			shareId: 'theme-large',
			acl: ['tt:user'],
			tags: Array.from({ length: 512 }, (_, n) => String(n).padStart(200, 'x')),
			crystal: {
				name: 'Large theme',
				theme: {
					colors: Object.fromEntries(
						['ink', 'text', 'muted', 'faint', 'border', 'borderLight', 'surface', 'surfaceAlt', 'surfaceHover', 'card', 'pageBg', 'accent'].map(
							(key) => [key, 'x'.repeat(4096)]
						)
					)
				}
			}
		}
	];
}
