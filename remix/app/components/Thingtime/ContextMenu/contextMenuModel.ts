// The Thing Context Menu action model — the single source of truth for what
// the menu contains, shared by every presentation (hover popover, right-click
// menu, programmatic modal). Presentations render this model; they never
// define their own actions, so hover/right-click/modal can't drift apart.
//
// Submenus are fully recursive: any action can carry a submenu whose actions
// can carry submenus, infinitely deep. The surface navigates them as
// drill-down levels inside one fixed window (no indentation, no new windows).
//
// Documented in the docs UI: /docs/design-system?component=thing-context-menu

export type ThingContextAction = {
	// unique within its level; drill paths are arrays of these
	id: string;
	// semantic verb consumers switch on ('change-type', 'copy', …); several
	// actions can share a command (e.g. every type option is 'change-type')
	command?: string;
	// arbitrary data delivered with onAction (e.g. the type or template value)
	payload?: unknown;
	label: string;
	icon: string;
	// short caption rendered under the label
	hint?: string;
	// keyboard shortcut label rendered on the right (display only)
	kbd?: string;
	danger?: boolean;
	disabled?: boolean;
	// radio-style current choice (rendered as menuitemradio + check)
	selected?: boolean;
	// nested drill-down level
	submenu?: ThingContextSubmenu;
};

export type ThingContextSection = {
	id: string;
	// uppercase mono section header; omit for the leading section
	label?: string;
	actions: ThingContextAction[];
};

export type ThingContextSubmenu = {
	// level title next to the back control; defaults to the parent label
	title?: string;
	sections: ThingContextSection[];
};

export type ThingContextMenuModel = {
	sections: ThingContextSection[];
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThingTypeOption = {
	key: string;
	label?: string;
	icon?: string;
	// wrappable types (e.g. containers) can wrap the current value instead of
	// replacing it — modelled as a nested drill level
	wrap?: string;
	// the value the type converts to (mirrors thingtime.settings.types shape)
	value?: unknown;
	// optional grouping ('JavaScript' | 'Custom' | anything)
	group?: string;
};

// Mirrors thingtime.settings.types.javascript + .custom: the live menu builds
// this list from settings; stories/docs use this default.
export const DEFAULT_THING_TYPES: ThingTypeOption[] = [
	{ key: 'any', label: 'any', icon: '🪄', group: 'JavaScript' },
	{ key: 'object', label: 'object', icon: '📦', value: {}, group: 'JavaScript' },
	{ key: 'array', label: 'array', icon: '📚', value: [], group: 'JavaScript' },
	{ key: 'string', label: 'string', icon: '💬', value: '', group: 'JavaScript' },
	{ key: 'number', label: 'number', icon: '💯', value: 0, group: 'JavaScript' },
	{ key: 'boolean', label: 'boolean', icon: '🌗', value: false, group: 'JavaScript' },
	{ key: 'function', label: 'function', icon: '📐', group: 'JavaScript' },
	{ key: 'thingtime-logo', label: 'Thingtime Logo', icon: '🌀', wrap: 'children', group: 'Custom' },
	{ key: 'violet', label: 'Violet', icon: '🌺', group: 'Custom' }
];

export type BuildTypesSubmenuOpts = {
	// semantic verb the leaves fire ('change-type' for conversions,
	// 'add-child' when picking the type of a new child)
	command?: string;
	// wrappable types drill one level deeper (replace/wrap); disable when
	// wrapping makes no sense (e.g. new children)
	wrapLevels?: boolean;
};

// One type option row. Wrappable types drill one level deeper (replace/wrap)
// — infinite depth falls out of the recursion for free.
const typeAction = (type: ThingTypeOption, opts: BuildTypesSubmenuOpts = {}): ThingContextAction => {
	const { command = 'change-type', wrapLevels = true } = opts;

	const base: ThingContextAction = {
		id: `type-${type.key}`,
		command,
		payload: { type },
		label: type.label || type.key,
		icon: type.icon || type.key
	};

	if (!type.wrap || !wrapLevels) {
		return base;
	}

	return {
		...base,
		command: undefined,
		payload: undefined,
		hint: 'Replace or wrap',
		submenu: {
			title: base.label,
			sections: [
				{
					id: `type-${type.key}-apply`,
					actions: [
						{
							id: 'replace-with-type',
							command,
							payload: { type },
							label: 'Replace value',
							icon: type.icon || '🌀',
							hint: `Become a fresh ${base.label}`
						},
						{
							id: 'wrap-with-type',
							command,
							payload: { type, wrap: true },
							label: 'Wrap current value',
							icon: '🎁',
							hint: `Keep the value inside a ${base.label}`
						}
					]
				}
			]
		}
	};
};

export const buildTypesSubmenu = (
	types: ThingTypeOption[] = DEFAULT_THING_TYPES,
	opts: BuildTypesSubmenuOpts & { title?: string } = {}
): ThingContextSubmenu => {
	const groups: { label: string | undefined; types: ThingTypeOption[] }[] = [];

	types.forEach((type) => {
		const label = type.group;
		const last = groups[groups.length - 1];

		if (last && last.label === label) {
			last.types.push(type);
		} else {
			groups.push({ label, types: [type] });
		}
	});

	return {
		title: opts.title || 'Change type',
		sections: groups.map((group, idx) => ({
			id: `types-${group.label || idx}`,
			label: group.label ? `${group.label} types` : undefined,
			actions: group.types.map((type) => typeAction(type, opts))
		}))
	};
};

// ---------------------------------------------------------------------------
// Templates — real starter values, applied via the 'apply-template' command
// ---------------------------------------------------------------------------

export type ThingTemplateOption = {
	key: string;
	label: string;
	icon?: string;
	description?: string;
	// the actual starter value the template applies
	value?: unknown;
	// nested template folders (drill another level)
	children?: ThingTemplateOption[];
};

export const DEFAULT_THING_TEMPLATES: ThingTemplateOption[] = [
	{ key: 'empty-thing', label: 'Empty thing', icon: '📦', description: 'Fresh object with no keys', value: {} },
	{
		key: 'note',
		label: 'Note',
		icon: '📖',
		description: 'title + body strings',
		value: { title: 'New note', body: 'Imagine..' }
	},
	{
		key: 'todo-list',
		label: 'Todo list',
		icon: '✅',
		description: 'array of { done, label }',
		value: { todos: [{ done: false, label: 'First thing to do' }] }
	},
	{
		key: 'contact',
		label: 'Contact',
		icon: '👤',
		description: 'name, email, phone',
		value: { name: '', email: '', phone: '' }
	},
	{
		key: 'more-templates',
		label: 'More templates…',
		icon: '🌟',
		children: [
			{
				key: 'recipe',
				label: 'Recipe',
				icon: '🌺',
				description: 'ingredients + steps',
				value: { name: 'New recipe', ingredients: [], steps: [] }
			},
			{
				key: 'bookmark',
				label: 'Bookmark',
				icon: '🔗',
				description: 'url + notes',
				value: { url: 'https://', notes: '' }
			},
			{
				key: 'journal-entry',
				label: 'Journal entry',
				icon: '✨',
				description: 'date + entry text',
				value: { date: '', entry: '' }
			}
		]
	}
];

const templateAction = (template: ThingTemplateOption): ThingContextAction => {
	if (template.children?.length) {
		return {
			id: `template-${template.key}`,
			label: template.label,
			icon: template.icon || '🌱',
			hint: template.description,
			submenu: {
				title: template.label.replace(/…$/, ''),
				sections: [
					{
						id: `templates-${template.key}`,
						actions: template.children.map(templateAction)
					}
				]
			}
		};
	}

	return {
		id: `template-${template.key}`,
		command: 'apply-template',
		payload: { template },
		label: template.label,
		icon: template.icon || '🌱',
		hint: template.description
	};
};

export const buildTemplatesSubmenu = (templates: ThingTemplateOption[] = DEFAULT_THING_TEMPLATES): ThingContextSubmenu => ({
	title: 'Apply template',
	sections: [
		{
			id: 'templates',
			label: 'Starters',
			actions: templates.map(templateAction)
		}
	]
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type ThingPermissionOption = {
	key: string;
	label: string;
	icon?: string;
	description?: string;
};

export const DEFAULT_THING_PERMISSIONS: ThingPermissionOption[] = [
	{ key: 'private', label: 'Private', icon: '🔒', description: 'Only you can see and edit' },
	{ key: 'shared', label: 'Shared with…', icon: '👥', description: 'Invited people can view or edit' },
	{ key: 'public', label: 'Public', icon: '🌍', description: 'Anyone with the link can view' }
];

export const buildPermissionsSubmenu = (
	permissions: ThingPermissionOption[] = DEFAULT_THING_PERMISSIONS,
	selectedKey = 'private'
): ThingContextSubmenu => ({
	title: 'Permissions',
	sections: [
		{
			id: 'permissions',
			label: 'Who can access',
			actions: permissions.map((permission) => {
				const base: ThingContextAction = {
					id: `permission-${permission.key}`,
					command: 'set-permission',
					payload: { permission },
					label: permission.label,
					icon: permission.icon || '🔒',
					hint: permission.description,
					selected: permission.key === selectedKey
				};

				if (permission.key !== 'shared') {
					return base;
				}

				// third drill level: manage the share list
				return {
					...base,
					command: undefined,
					payload: undefined,
					submenu: {
						title: 'Shared with',
						sections: [
							{
								id: 'shared-people',
								label: 'People',
								actions: [
									{
										id: 'invite-person',
										command: 'invite-person',
										label: 'Invite by email…',
										icon: '✉️',
										hint: 'Send a view or edit invite'
									},
									{
										id: 'share-as-shared',
										command: 'set-permission',
										payload: { permission },
										label: 'Set to shared',
										icon: '👥',
										hint: 'Only invited people'
									}
								]
							}
						]
					}
				};
			})
		}
	]
});

// ---------------------------------------------------------------------------
// The default, fully-loaded menu model
// ---------------------------------------------------------------------------

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

// Build the default menu model. Consumers can filter or extend the returned
// sections, but the shape/order here is the canonical design.
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
					command: 'toggle-edit-mode',
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
					submenu: buildTypesSubmenu(types)
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
					submenu: buildTemplatesSubmenu(templates)
				},
				{ id: 'modify', command: 'modify', label: 'Modify…', icon: '✏️', hint: 'Open the value editor' },
				{ id: 'duplicate', command: 'duplicate', label: 'Duplicate', icon: '🐑', kbd: '⌘D' }
			]
		});
	}

	sections.push({
		id: 'clipboard',
		label: 'Clipboard',
		actions: [
			{ id: 'copy', command: 'copy', label: 'Copy', icon: '📋', kbd: '⌘C' },
			...(!readonly ? [{ id: 'cut', command: 'cut', label: 'Cut', icon: '✂️', kbd: '⌘X' }] : []),
			...(!readonly ? [{ id: 'paste', command: 'paste', label: 'Paste', icon: '📥', kbd: '⌘V' }] : [])
		]
	});

	sections.push({
		id: 'sharing',
		label: 'Sharing',
		actions: [
			{ id: 'share', command: 'share', label: 'Share…', icon: '🔗', hint: 'Copy a link to this thing' },
			{
				id: 'permissions',
				label: 'Permissions…',
				icon: '🔒',
				submenu: buildPermissionsSubmenu(permissions, selectedPermissionKey)
			}
		]
	});

	if (!readonly && canDelete) {
		sections.push({
			id: 'danger',
			actions: [
				{ id: 'recycle', command: 'recycle', label: 'Recycle', icon: '🗑️', hint: 'Move to the recycle bin', danger: true }
			]
		});
	}

	return { sections };
};

// Resolve a drill path of action ids (['change-type', 'type-thingtime-logo'])
// to the stack of actions it names; stops at the first miss.
export const resolveDrillPath = (model: ThingContextMenuModel, path?: string[]): ThingContextAction[] => {
	const stack: ThingContextAction[] = [];
	let sections = model.sections;

	for (const id of path || []) {
		const found = sections.flatMap((section) => section.actions).find((action) => action.id === id);

		if (!found?.submenu) {
			break;
		}

		stack.push(found);
		sections = found.submenu.sections;
	}

	return stack;
};
