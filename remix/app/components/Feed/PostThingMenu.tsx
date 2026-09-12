import React from 'react';
import { PersistedThingMenu } from '~/components/Thingtime/ContextMenu/PersistedThingMenu';
import type { ThingContextSection } from '~/components/Thingtime/ContextMenu/contextMenuModel';
import { CIRCLE_META, type PublicPost, type PostVisibility } from './feedTypes';

// A post contributes its schema-specific actions to the parent Thing menu.
// Existing writers/moderation dialogs stay the authority for these actions.
export function PostThingMenu({ post, mediaThing, isOwner, canModerate, canReport, guestReport, flairs, onOpen, handlers, openHref }: {
  post: PublicPost; mediaThing?: boolean; isOwner: boolean; canModerate: boolean; canReport: boolean; guestReport: boolean;
  flairs: Array<{ id: string; label: string; emoji?: string | null; modOnly?: boolean }> | null;
  onOpen: () => void; openHref: string;
  handlers: { edit: () => void; delete: () => void; privacy: (value: PostVisibility) => void; report: () => void;
    remove: () => void; moderate: (action: string, extra?: Record<string, unknown>) => void; flair: (id: string | null) => void };
}) {
  const extensions: ThingContextSection[] = [];
  const privacy: ThingContextSection = { id: 'privacy', label: 'Privacy', actions: (Object.keys(CIRCLE_META) as PostVisibility[]).map(value => ({
    id: `privacy-${value}`, command: 'privacy', payload: value, label: CIRCLE_META[value].label, icon: CIRCLE_META[value].emoji, selected: post.visibility === value
  })) };
  if (canReport || guestReport) extensions.push({ id: 'report', actions: [{ id: 'report', command: 'report', label: 'Report to moderators', icon: '🚩' }] });
  if (!mediaThing && post.subspace && (isOwner || canModerate)) {
    if (canModerate) extensions.push({ id: 'moderation', label: 'Moderation', actions: [
      { id: post.subspaceMod?.removed ? 'approve' : 'remove', command: post.subspaceMod?.removed ? 'approve' : 'remove', label: post.subspaceMod?.removed ? 'Approve' : 'Remove', icon: '🧹' },
      { id: 'pin', command: post.subspaceMod?.pinned ? 'unpin' : 'pin', label: post.subspaceMod?.pinned ? 'Unpin' : 'Pin', icon: '📌' },
      { id: 'lock', command: post.subspaceMod?.locked ? 'unlock' : 'lock', label: post.subspaceMod?.locked ? 'Unlock comments' : 'Lock comments', icon: '🔒' },
      { id: 'nsfw', command: 'nsfw', label: post.subspaceMod?.nsfw ? 'Unmark 18+' : 'Mark 18+', icon: '🔞' },
      { id: 'spoiler', command: 'spoiler', label: post.subspaceMod?.spoiler ? 'Unmark spoiler' : 'Mark spoiler', icon: '⚠️' }
    ] });
    extensions.push({ id: 'flair', actions: [{ id: 'flair', label: 'Flair', icon: '🏷️', submenu: { sections: [{ id: 'flair-options', actions: [
      { id: 'no-flair', command: 'flair', payload: null, label: 'No flair', icon: '🏷️', selected: !post.flair?.id },
      ...(flairs || []).filter(flair => canModerate || !flair.modOnly).map(flair => ({ id: flair.id, command: 'flair', payload: flair.id, label: flair.label, icon: flair.emoji || '🏷️', selected: post.flair?.id === flair.id })),
      ...(flairs === null ? [{ id: 'loading', label: 'Loading flairs…', icon: '🏷️', disabled: true }] : [])
    ] }] } }] });
  }
  return <PersistedThingMenu id={post.id} initialThing={post} label={mediaThing ? 'Media options' : 'Post options'} openHref={openHref}
    onOpen={onOpen} extensions={extensions} capabilities={{ edit: isOwner && !mediaThing, delete: isOwner && !mediaThing,
      share: isOwner && !mediaThing ? { submenu: { title: 'Share / permissions', sections: [privacy] } } : false }}
    onAction={({ action }) => {
      const command = action.command;
      if (command === 'edit') handlers.edit();
      else if (command === 'delete') handlers.delete();
      else if (command === 'privacy') handlers.privacy(action.payload as PostVisibility);
      else if (command === 'report') handlers.report();
      else if (command === 'remove') handlers.remove();
      else if (command === 'flair') { const flairId = action.payload as string | null; if (canModerate) handlers.moderate('flair', { flairId }); else handlers.flair(flairId); }
      else if (command === 'nsfw' || command === 'spoiler') handlers.moderate(command, { value: !post.subspaceMod?.[command] });
      else if (command && canModerate) handlers.moderate(command);
    }} />;
}
