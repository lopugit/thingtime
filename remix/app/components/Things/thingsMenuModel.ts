// Right-click menu models for /things — built on the design-system Thing
// Context Menu grammar (contextMenuModel.ts), so the Drive surface gets the
// same drill-down window, keyboard handling, and presentation code as the
// Thingtime tree instead of a second menu implementation.
//
// Two models: one for right-clicking a thing (acts on the selection when the
// target is part of it), one for right-clicking the background (create /
// paste / arrange / select). Every leaf fires a command the page dispatches.

import type {
  ThingContextAction,
  ThingContextMenuModel,
  ThingContextSection,
  ThingContextSubmenu
} from '~/components/Thingtime/ContextMenu/contextMenuModel';

import {
  THINGS_GROUP_OPTIONS,
  THINGS_SORT_OPTIONS,
  ThingsDisplayMode,
  ThingsGroupBy,
  ThingsSort,
  ThingsThing,
  ThingsView,
  isDuplicable,
  isFolder,
  primaryKindOf
} from './thingsCore';

const canRename = (thing: ThingsThing) => {
  const kind = primaryKindOf(thing);
  return kind === 'folder' || kind === 'data' || kind === 'schema';
};

// "Copy 4 things" when acting on a multi-selection, plain verb otherwise
const countLabel = (verb: string, count: number) => (count > 1 ? `${verb} ${count} things` : verb);

export type ThingsItemMenuArgs = {
  thing: ThingsThing;
  // how many things the action will touch (1 unless the target is inside a
  // bigger selection)
  actCount: number;
  clipboardCount: number;
};

export const buildThingsItemMenu = ({ thing, actCount, clipboardCount }: ThingsItemMenuArgs): ThingContextMenuModel => {
  const folder = isFolder(thing);
  const sections: ThingContextSection[] = [];

  sections.push({
    id: 'open',
    actions: [
      folder
        ? { id: 'open', command: 'open', label: 'Open folder', icon: '📂', lucide: 'folder-open' }
        : thing.thingtime.includes('post')
          ? { id: 'open', command: 'open', label: 'Open post', icon: '📝', lucide: 'external-link' }
          : { id: 'open', command: 'open', label: 'Preview', icon: '👀', lucide: 'eye' },
      { id: 'copy-link', command: 'copy-link', label: 'Copy link', icon: '🔗', lucide: 'link' }
    ]
  });

  sections.push({
    id: 'organise',
    label: 'Organise',
    actions: [
      ...(canRename(thing) && actCount === 1
        ? [{ id: 'rename', command: 'rename', label: 'Rename…', icon: '✏️', lucide: 'pen-line' } as ThingContextAction]
        : []),
      { id: 'move', command: 'move', label: `${countLabel('Move', actCount)} to…`, icon: '📁', lucide: 'folder-input' },
      {
        id: 'share',
        command: 'share',
        label: `${countLabel('Share', actCount)}…`,
        icon: '🌐',
        lucide: 'share-2',
        ...(folder ? { hint: 'Audience for the folder — optionally everything inside' } : {})
      }
    ]
  });

  sections.push({
    id: 'clipboard',
    label: 'Clipboard',
    actions: [
      {
        id: 'copy',
        command: 'copy',
        label: countLabel('Copy', actCount),
        icon: '📋',
        lucide: 'copy',
        kbd: '⌘C',
        ...(folder ? { hint: 'Folders copy everything inside' } : {})
      },
      // one-click copy-into-this-folder (no clipboard round-trip). Hidden for
      // uncopyable kinds the server would refuse anyway. No kbd: ⌘D is the
      // browser's bookmark chord, so Duplicate stays context-menu only.
      ...(isDuplicable(thing)
        ? [
            {
              id: 'duplicate',
              command: 'duplicate',
              label: countLabel('Duplicate', actCount),
              // 🐑 is the codebase's Duplicate emoji (theme/icons.tsx maps it
              // to lucide copy-plus); emoji icon style falls back to 🤷‍♂️ for
              // anything outside the emoji set, so no glyphs like ⧉ here
              icon: '🐑',
              lucide: 'copy-plus',
              ...(folder ? { hint: 'Duplicates the folder and everything inside' } : {})
            } as ThingContextAction
          ]
        : []),
      { id: 'cut', command: 'cut', label: countLabel('Cut', actCount), icon: '✂️', lucide: 'scissors', kbd: '⌘X' },
      ...(folder
        ? [
            {
              id: 'paste-into',
              command: 'paste-into',
              label: `Paste ${clipboardCount || ''} into folder`.replace('  ', ' '),
              icon: '📥',
              lucide: 'clipboard-paste',
              disabled: !clipboardCount,
              hint: clipboardCount ? undefined : 'Nothing on the clipboard yet'
            } as ThingContextAction
          ]
        : [])
    ]
  });

  sections.push({
    id: 'danger',
    actions: [
      {
        id: 'delete',
        command: 'delete',
        label: countLabel('Delete', actCount),
        icon: '🗑️',
        lucide: 'trash-2',
        kbd: '⌫',
        danger: true
      }
    ]
  });

  return { sections };
};

export type ThingsBackgroundMenuArgs = {
  clipboardCount: number;
  itemCount: number;
  sort: ThingsSort;
  groupBy: ThingsGroupBy;
  view: ThingsView;
  displayMode: ThingsDisplayMode;
};

const sortSubmenu = (sort: ThingsSort): ThingContextSubmenu => ({
  title: 'Sort by',
  sections: [
    {
      id: 'sort-options',
      label: 'Order',
      actions: THINGS_SORT_OPTIONS.map((option) => ({
        id: `sort-${option.id}`,
        command: 'set-sort',
        payload: { sort: option.id },
        label: option.label,
        icon: option.icon,
        lucide: option.lucide,
        selected: sort === option.id
      }))
    }
  ]
});

const groupSubmenu = (groupBy: ThingsGroupBy): ThingContextSubmenu => ({
  title: 'Group by',
  sections: [
    {
      id: 'group-options',
      label: 'Grouping',
      actions: THINGS_GROUP_OPTIONS.map((option) => ({
        id: `group-${option.id}`,
        command: 'set-group',
        payload: { groupBy: option.id },
        label: option.label,
        icon: option.icon,
        lucide: option.lucide,
        selected: groupBy === option.id
      }))
    }
  ]
});

const viewSubmenu = (view: ThingsView, displayMode: ThingsDisplayMode): ThingContextSubmenu => ({
  title: 'View',
  sections: [
    {
      id: 'view-options',
      label: 'Layout',
      actions: [
        { id: 'view-grid', command: 'set-view', payload: { view: 'grid' }, label: 'Grid', icon: '🔲', lucide: 'layout-grid', selected: view === 'grid' },
        { id: 'view-list', command: 'set-view', payload: { view: 'list' }, label: 'List', icon: '📃', lucide: 'rows-3', selected: view === 'list' },
        { id: 'view-columns', command: 'set-view', payload: { view: 'columns' }, label: 'Columns', icon: '🪜', lucide: 'columns-3', selected: view === 'columns' }
      ]
    },
    {
      id: 'display-options',
      label: 'Show',
      actions: [
        { id: 'display-name', command: 'set-display', payload: { displayMode: 'name' }, label: 'Names', icon: '🏷️', lucide: 'tag', selected: displayMode === 'name' },
        { id: 'display-preview', command: 'set-display', payload: { displayMode: 'preview' }, label: 'Previews', icon: '👀', lucide: 'eye', selected: displayMode === 'preview' }
      ]
    }
  ]
});

export const buildThingsBackgroundMenu = ({
  clipboardCount,
  itemCount,
  sort,
  groupBy,
  view,
  displayMode
}: ThingsBackgroundMenuArgs): ThingContextMenuModel => ({
  sections: [
    {
      id: 'create',
      actions: [
        { id: 'new-folder', command: 'new-folder', label: 'New folder…', icon: '📁', lucide: 'folder-plus' },
        {
          id: 'paste',
          command: 'paste',
          label: clipboardCount ? `Paste ${clipboardCount} here` : 'Paste',
          icon: '📥',
          lucide: 'clipboard-paste',
          kbd: '⌘V',
          disabled: !clipboardCount,
          ...(clipboardCount ? {} : { hint: 'Copy or cut things first' })
        }
      ]
    },
    {
      id: 'arrange',
      label: 'Arrange',
      actions: [
        { id: 'sort-by', label: 'Sort by…', icon: '🔃', lucide: 'arrow-up-down', submenu: sortSubmenu(sort) },
        { id: 'group-by', label: 'Group by…', icon: '🗂️', lucide: 'layers', submenu: groupSubmenu(groupBy) },
        { id: 'view', label: 'View…', icon: '👁️', lucide: 'panels-top-left', submenu: viewSubmenu(view, displayMode) }
      ]
    },
    {
      id: 'select',
      actions: [
        {
          id: 'select-all',
          command: 'select-all',
          label: 'Select all',
          icon: '✅',
          lucide: 'square-check-big',
          kbd: '⌘A',
          disabled: !itemCount
        }
      ]
    }
  ]
});
