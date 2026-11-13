import React, { useRef, useState } from 'react';
import { Box, Flex, IconButton } from '@chakra-ui/react';
import { ArrowLeft, ArrowRight, GripVertical, Pin } from 'lucide-react';

export type ThingPinControl = {
  id: string;
  label: string;
  pinned: boolean;
  reordering: boolean;
  index: number;
  count: number;
  moveBy: (offset: number) => void;
  moveBefore: (target: string, after?: boolean) => void;
};
/** The drag handle alone captures touch; the rest of the page still scrolls.
 * Arrow buttons provide a single-pointer alternative and arrows/Home/End a
 * keyboard alternative. Dropping performs one revision-fenced write. */
export function ThingPinControls({ control }: { control?: ThingPinControl }) {
  const pointer = useRef<{ id: number; target: string | null; after: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  if (!control?.pinned) return null;
  if (!control.reordering) return <Box as="span" aria-label="Pinned here" color="var(--tt-muted, #9a9aa6)" display="inline-flex" padding={1}><Pin size={13} /></Box>;
  return <Flex alignItems="center" gap={1} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <IconButton aria-label={`Move ${control.label} earlier`} isDisabled={control.index === 0} icon={<ArrowLeft size={14} />} size="sm" minWidth="44px" minHeight="44px" variant="ghost" onClick={() => control.moveBy(-1)} />
    <IconButton aria-label={`Drag ${control.label} to reorder pins`} aria-pressed={dragging} title="Drag to reorder. Use arrow keys, Home or End to move." icon={<GripVertical size={16} />}
      size="sm" minWidth="44px" minHeight="44px" variant="outline" background={dragging ? 'var(--tt-accent-soft, rgba(244,114,182,0.18))' : undefined} sx={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
      onDragStart={event => event.preventDefault()}
      onKeyDown={event => {
        const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'Home' ? -control.index : event.key === 'End' ? control.count - control.index - 1 : 0;
        if (!offset) return;
        event.preventDefault(); event.stopPropagation(); control.moveBy(offset);
      }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = { id: event.pointerId, target: null, after: false }; setDragging(true); }}
      onPointerMove={event => {
        if (pointer.current?.id !== event.pointerId) return;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-pin-id]');
        const surface = event.currentTarget.closest('[data-pin-surface]');
        surface?.querySelectorAll('[data-pin-drop-target]').forEach(element => element.removeAttribute('data-pin-drop-target'));
        pointer.current.target = target && target.closest('[data-pin-surface]') === surface ? target.getAttribute('data-pin-id') : null;
        if (target && pointer.current.target && pointer.current.target !== control.id) {
          const bounds = target.getBoundingClientRect();
          pointer.current.after = event.clientY > bounds.top + bounds.height / 2;
          target.setAttribute('data-pin-drop-target', pointer.current.after ? 'after' : 'before');
        }
      }}
      onPointerUp={event => {
        if (pointer.current?.id !== event.pointerId) return;
        const { target, after } = pointer.current; pointer.current = null; setDragging(false);
        event.currentTarget.closest('[data-pin-surface]')?.querySelectorAll('[data-pin-drop-target]').forEach(element => element.removeAttribute('data-pin-drop-target'));
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (target && target !== control.id) control.moveBefore(target, after);
      }}
      onPointerCancel={event => { pointer.current = null; setDragging(false); event.currentTarget.closest('[data-pin-surface]')?.querySelectorAll('[data-pin-drop-target]').forEach(element => element.removeAttribute('data-pin-drop-target')); }} />
    <IconButton aria-label={`Move ${control.label} later`} isDisabled={control.index === control.count - 1} icon={<ArrowRight size={14} />} size="sm" minWidth="44px" minHeight="44px" variant="ghost" onClick={() => control.moveBy(1)} />
  </Flex>;
}
