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
	// contextual Lucide icon name for the lucide icon style (falls back to the
	// emoji's mapped twin when omitted) — e.g. collapse-all wants folding
	// chevrons, not a literal leaf
	lucide?: string;
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
	lucide?: string;
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
	{ key: 'any', label: 'any', icon: '🪄', lucide: 'wand', group: 'JavaScript' },
	{ key: 'object', label: 'object', icon: '📦', lucide: 'box', value: {}, group: 'JavaScript' },
	{ key: 'array', label: 'array', icon: '📚', lucide: 'brackets', value: [], group: 'JavaScript' },
	{ key: 'string', label: 'string', icon: '💬', lucide: 'quote', value: '', group: 'JavaScript' },
	{ key: 'number', label: 'number', icon: '💯', lucide: 'hash', value: 0, group: 'JavaScript' },
	{ key: 'boolean', label: 'boolean', icon: '🌗', lucide: 'toggle-left', value: false, group: 'JavaScript' },
	{ key: 'function', label: 'function', icon: '📐', lucide: 'square-function', group: 'JavaScript' },
	{
		key: 'editorjs',
		label: 'Editor.js',
		icon: '📝',
		lucide: 'file-text',
		value: () => ({ kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: '' } }] }),
		group: 'Custom'
	},
	{ key: 'thingtime-logo', label: 'Thingtime Logo', icon: '🌀', lucide: 'shell', wrap: 'children', group: 'Custom' },
	{ key: 'violet', label: 'Violet', icon: '🌺', lucide: 'flower-2', group: 'Custom' }
];

export type BuildTypesSubmenuOpts = {
	// semantic verb the leaves fire ('change-type' for conversions,
	// 'add-child' when picking the type of a new child)
	command?: string;
	// wrappable types drill one level deeper (replace/wrap); disable when
	// wrapping makes no sense (e.g. new children)
	wrapLevels?: boolean;
	// radio-style current representation in the type picker
	selectedKey?: string;
};

// One type option row. Wrappable types drill one level deeper (replace/wrap)
// — infinite depth falls out of the recursion for free.
const typeAction = (type: ThingTypeOption, opts: BuildTypesSubmenuOpts = {}): ThingContextAction => {
	const { command = 'change-type', wrapLevels = true, selectedKey } = opts;
	const selected = selectedKey === undefined ? undefined : selectedKey.toLowerCase() === type.key.toLowerCase();

	const base: ThingContextAction = {
		id: `type-${type.key}`,
		command,
		payload: { type },
		label: type.label || type.key,
		icon: type.icon || type.key,
		lucide: type.lucide,
		selected
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
							lucide: 'replace',
							hint: `Become a fresh ${base.label}`
						},
						{
							id: 'wrap-with-type',
							command,
							payload: { type, wrap: true },
							label: 'Wrap current value',
							icon: '🎁',
							lucide: 'gift',
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
	lucide?: string;
	description?: string;
	// the actual starter value the template applies
	value?: unknown;
	// nested template folders (drill another level)
	children?: ThingTemplateOption[];
};

export const DEFAULT_THING_TEMPLATES: ThingTemplateOption[] = [
	{ key: 'empty-thing', label: 'Empty thing', icon: '📦', lucide: 'package-open', description: 'Fresh object with no keys', value: {} },
	{
		key: 'note',
		label: 'Note',
		icon: '📖',
		lucide: 'notebook-pen',
		description: 'title + body strings',
		value: { title: 'New note', body: 'Imagine..' }
	},
	{
		key: 'todo-list',
		label: 'Todo list',
		icon: '✅',
		lucide: 'list-checks',
		description: 'array of { done, label }',
		value: { todos: [{ done: false, label: 'First thing to do' }] }
	},
	{
		key: 'contact',
		label: 'Contact',
		icon: '👤',
		lucide: 'contact',
		description: 'name, email, phone',
		value: { name: '', email: '', phone: '' }
	},
	{
		key: 'more-templates',
		label: 'More templates…',
		icon: '🌟',
		lucide: 'sparkles',
		children: [
			{
				key: 'recipe',
				label: 'Recipe',
				icon: '🌺',
				lucide: 'chef-hat',
				description: 'ingredients + steps',
				value: { name: 'New recipe', ingredients: [], steps: [] }
			},
			{
				key: 'bookmark',
				label: 'Bookmark',
				icon: '🔗',
				lucide: 'bookmark',
				description: 'url + notes',
				value: { url: 'https://', notes: '' }
			},
			{
				key: 'journal-entry',
				label: 'Journal entry',
				icon: '✨',
				lucide: 'notebook-text',
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
			lucide: template.lucide,
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
		lucide: template.lucide,
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
	lucide?: string;
	description?: string;
};

export const DEFAULT_THING_PERMISSIONS: ThingPermissionOption[] = [
	{ key: 'private', label: 'Private', icon: '🔒', lucide: 'lock', description: 'Only you can see and edit' },
	{ key: 'shared', label: 'Shared with…', icon: '👥', lucide: 'users', description: 'Invited people can view or edit' },
	{ key: 'public', label: 'Public', icon: '🌍', lucide: 'globe', description: 'Anyone with the link can view' }
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
					lucide: permission.lucide,
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
										lucide: 'mail',
										hint: 'Send a view or edit invite'
									},
									{
										id: 'share-as-shared',
										command: 'set-permission',
										payload: { permission },
										label: 'Set to shared',
										icon: '👥',
										lucide: 'users',
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
	// rows with hideable content get the View section (collapse/expand verbs);
	// containers additionally get descendant cascade actions
	collapsible?: boolean;
	collapsibleChildren?: boolean;
	collapsed?: boolean;
	types?: ThingTypeOption[];
	templates?: ThingTemplateOption[];
	permissions?: ThingPermissionOption[];
	selectedTypeKey?: string;
	selectedPermissionKey?: string;
};

// Build the default menu model. Consumers can filter or extend the returned
// sections, but the shape/order here is the canonical design.
export const buildThingContextMenuModel = (args: BuildThingContextMenuModelArgs = {}): ThingContextMenuModel => {
	const {
		editMode = false,
		readonly = false,
		canDelete = true,
		collapsible = false,
		collapsibleChildren = collapsible,
		collapsed = false,
		types = DEFAULT_THING_TYPES,
		templates = DEFAULT_THING_TEMPLATES,
		permissions = DEFAULT_THING_PERMISSIONS,
		selectedTypeKey,
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
					lucide: editMode ? 'eye' : 'paintbrush',
					kbd: '⌘E'
				}
			]
		}
	];

	// collapse/expand are view state, not mutations — they show in readonly too
	if (collapsible) {
		const viewActions: ThingContextAction[] = [
			collapsed
				? { id: 'expand', command: 'expand', label: 'Expand', icon: '▾', lucide: 'chevron-down' }
				: { id: 'collapse', command: 'collapse', label: 'Collapse', icon: '▸', lucide: 'chevron-right' }
		];

		if (collapsibleChildren) {
			viewActions.push(
				{ id: 'collapse-all', command: 'collapse-all', label: 'Collapse all', icon: '🍂', lucide: 'chevrons-down-up', hint: 'This thing + everything inside' },
				{ id: 'expand-all', command: 'expand-all', label: 'Expand all', icon: '🌳', lucide: 'chevrons-up-down', hint: 'This thing + everything inside' }
			);
		}

		sections.push({
			id: 'view',
			label: 'View',
			actions: viewActions
		});
	}

	if (!readonly) {
		sections.push({
			id: 'type',
			label: 'Type',
			actions: [
				{
					id: 'change-type',
					label: 'Change type…',
					icon: '🌀',
					lucide: 'replace',
					hint: 'Convert or wrap the current value',
					submenu: buildTypesSubmenu(types, { selectedKey: selectedTypeKey })
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
					lucide: 'sprout',
					hint: 'Default / starter values',
					submenu: buildTemplatesSubmenu(templates)
				},
				{ id: 'modify', command: 'modify', label: 'Modify…', icon: '✏️', lucide: 'pen-line', hint: 'Open the value editor' },
				{ id: 'duplicate', command: 'duplicate', label: 'Duplicate', icon: '🐑', lucide: 'copy-plus', kbd: '⌘D' }
			]
		});
	}

	sections.push({
		id: 'clipboard',
		label: 'Clipboard',
		actions: [
			{ id: 'copy', command: 'copy', label: 'Copy', icon: '📋', lucide: 'copy', kbd: '⌘C' },
			...(!readonly ? [{ id: 'cut', command: 'cut', label: 'Cut', icon: '✂️', lucide: 'scissors', kbd: '⌘X' }] : []),
			...(!readonly ? [{ id: 'paste', command: 'paste', label: 'Paste', icon: '📥', lucide: 'clipboard-paste', kbd: '⌘V' }] : [])
		]
	});

	sections.push({
		id: 'sharing',
		label: 'Sharing',
		actions: [
			{ id: 'share', command: 'share', label: 'Share…', icon: '🔗', lucide: 'share-2', hint: 'Copy a link to this thing' },
			{
				id: 'permissions',
				label: 'Permissions…',
				icon: '🔒',
				lucide: 'lock',
				submenu: buildPermissionsSubmenu(permissions, selectedPermissionKey)
			}
		]
	});

	if (!readonly && canDelete) {
		sections.push({
			id: 'danger',
			actions: [
				{ id: 'recycle', command: 'recycle', label: 'Recycle', icon: '🗑️', lucide: 'trash-2', hint: 'Move to the recycle bin', danger: true }
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
