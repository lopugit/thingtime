// The Thing Context Menu action model — the single source of truth for what
// the menu contains, shared by every presentation (hover popover, right-click
// menu, programmatic modal). Presentations render this model; they never
// define their own actions, so hover/right-click/modal can't drift apart.
//
// Documented in the docs UI: /docs/design-system?component=thing-context-menu

export type ThingTypeOption = {
	key: string;
	label?: string;
	icon?: string;
	// wrappable types (e.g. Thingtime Logo) can wrap the current value
	wrap?: string;
};

export type ThingTemplateOption = {
	key: string;
	label: string;
	icon?: string;
	description?: string;
};

export type ThingPermissionOption = {
	key: string;
	label: string;
	icon?: string;
	description?: string;
};

export type ThingContextSubmenu =
	| { kind: 'types'; options: ThingTypeOption[] }
	| { kind: 'templates'; options: ThingTemplateOption[] }
	| { kind: 'permissions'; options: ThingPermissionOption[]; selectedKey?: string };

export type ThingContextAction = {
	id: string;
	label: string;
	icon: string;
	// short caption rendered under the label (e.g. what the action does)
	hint?: string;
	// keyboard shortcut label rendered on the right (display only)
	kbd?: string;
	danger?: boolean;
	disabled?: boolean;
	submenu?: ThingContextSubmenu;
};

export type ThingContextSection = {
	id: string;
	// uppercase mono section header; omit for the leading section
	label?: string;
	actions: ThingContextAction[];
};

export type ThingContextMenuModel = {
	sections: ThingContextSection[];
};

// Mirrors thingtime.settings.types.javascript + .custom (see SettingsMenu):
// the live menu builds this list from settings; stories/docs use this default.
export const DEFAULT_THING_TYPES: ThingTypeOption[] = [
	{ key: 'any', label: 'any', icon: '🪄' },
	{ key: 'object', label: 'object', icon: '📦' },
	{ key: 'array', label: 'array', icon: '📚' },
	{ key: 'string', label: 'string', icon: '💬' },
	{ key: 'number', label: 'number', icon: '💯' },
	{ key: 'boolean', label: 'boolean', icon: '🌗' },
	{ key: 'function', label: 'function', icon: '📐' },
	{ key: 'thingtime-logo', label: 'Thingtime Logo', icon: '🌀', wrap: 'children' },
	{ key: 'violet', label: 'Violet', icon: '🌺' }
];

export const DEFAULT_THING_TEMPLATES: ThingTemplateOption[] = [
	{ key: 'empty-thing', label: 'Empty thing', icon: '📦', description: 'Fresh object with no keys' },
	{ key: 'note', label: 'Note', icon: '📖', description: 'title + body strings' },
	{ key: 'todo-list', label: 'Todo list', icon: '✅', description: 'array of { done, label }' },
	{ key: 'contact', label: 'Contact', icon: '👤', description: 'name, email, phone' },
	{ key: 'defaults', label: 'Type defaults', icon: '🌱', description: 'Reset to the default value for this type' }
];

export const DEFAULT_THING_PERMISSIONS: ThingPermissionOption[] = [
	{ key: 'private', label: 'Private', icon: '🔒', description: 'Only you can see and edit' },
	{ key: 'shared', label: 'Shared with…', icon: '👥', description: 'Invited people can view or edit' },
	{ key: 'public', label: 'Public', icon: '🌍', description: 'Anyone with the link can view' }
];

export type BuildThingContextMenuModelArgs = {
	// current mode; the toggle item reflects it
	editMode?: boolean;
	// read-only things hide every mutating action
	readonly?: boolean;
	// hide the delete action when the thing has no parent (nothing to remove)
	canDelete?: boolean;
	types?: ThingTypeOption[];
	templates?: ThingTemplateOption[];
	permissions?: ThingPermissionOption[];
	selectedPermissionKey?: string;
};

// Build the default, fully-loaded menu model. Consumers can filter or extend
// the returned sections, but the shape/order here is the canonical design.
export const buildThingContextMenuModel = (args: BuildThingContextMenuModelArgs = {}): ThingContextMenuModel => {
	const {
		editMode = false,
		readonly = false,
		canDelete = true,
		types = DEFAULT_THING_TYPES,
		templates = DEFAULT_THING_TEMPLATES,
		permissions = DEFAULT_THING_PERMISSIONS,
		selectedPermissionKey = 'private'
	} = args;

	const sections: ThingContextSection[] = [
		{
			id: 'mode',
			actions: [
				{
					id: 'toggle-edit-mode',
					label: editMode ? 'Done editing' : 'Toggle Edit Mode',
					icon: editMode ? '👀' : '🎨',
					kbd: '⌘E'
				}
			]
		}
	];

	if (!readonly) {
		sections.push({
			id: 'type',
			label: 'Type',
			actions: [
				{
					id: 'change-type',
					label: 'Change type…',
					icon: '🌀',
					hint: 'Convert or wrap the current value',
					submenu: { kind: 'types', options: types }
				}
			]
		});

		sections.push({
			id: 'value',
			label: 'Value',
			actions: [
				{
					id: 'apply-template',
					label: 'Apply template…',
					icon: '🌱',
					hint: 'Default / starter values',
					submenu: { kind: 'templates', options: templates }
				},
				{ id: 'modify', label: 'Modify…', icon: '✏️', hint: 'Open the value editor' },
				{ id: 'duplicate', label: 'Duplicate', icon: '🐑', kbd: '⌘D' }
			]
		});
	}

	sections.push({
		id: 'clipboard',
		label: 'Clipboard',
		actions: [
			{ id: 'copy', label: 'Copy', icon: '📋', kbd: '⌘C' },
			...(!readonly ? [{ id: 'cut', label: 'Cut', icon: '✂️', kbd: '⌘X' }] : []),
			...(!readonly ? [{ id: 'paste', label: 'Paste', icon: '📥', kbd: '⌘V' }] : [])
		]
	});

	sections.push({
		id: 'sharing',
		label: 'Sharing',
		actions: [
			{ id: 'share', label: 'Share…', icon: '🔗', hint: 'Copy a link to this thing' },
			{
				id: 'permissions',
				label: 'Permissions…',
				icon: '🔒',
				submenu: { kind: 'permissions', options: permissions, selectedKey: selectedPermissionKey }
			}
		]
	});

	if (!readonly && canDelete) {
		sections.push({
			id: 'danger',
			actions: [{ id: 'recycle', label: 'Recycle', icon: '🗑️', hint: 'Move to the recycle bin', danger: true }]
		});
	}

	return { sections };
};
