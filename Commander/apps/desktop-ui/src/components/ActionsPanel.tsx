import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchHit } from '@commander/protocol';
import { Check, CornerDownLeft } from 'lucide-react';

export function ActionsPanel({ item, onAction }: { item: SearchHit; onAction(id: string): void }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const selectAction = useCallback((index: number) => {
    selectedIndexRef.current = index;
    setSelectedIndex(index);
  }, []);

  useEffect(() => {
    selectAction(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [item.id, selectAction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = Math.max(0, Math.min(item.actions.length - 1, selectedIndexRef.current + direction));
        selectAction(nextIndex);

        const list = listRef.current;
        const row = list?.children[nextIndex];
        if (!list || !row) return;
        // Scroll only the menu. Scrolling ancestors can shift the launcher toolbar.
        const listBounds = list.getBoundingClientRect();
        const rowBounds = row.getBoundingClientRect();
        if (rowBounds.top < listBounds.top) list.scrollTop += rowBounds.top - listBounds.top;
        else if (rowBounds.bottom > listBounds.bottom) list.scrollTop += rowBounds.bottom - listBounds.bottom;
      } else if (event.key === 'Enter') {
        const action = item.actions[selectedIndexRef.current];
        if (!action) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onAction(action.id);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [item.actions, onAction, selectAction]);

  return (
    <aside className="actions-panel" aria-label={`Actions for ${item.title}`}>
      <header>Actions</header>
      <div ref={listRef} className="actions-list" role="menu">
        {item.actions.map((action, index) => (
          <button
            type="button"
            role="menuitem"
            className={index === selectedIndex ? 'action-row selected' : 'action-row'}
            key={action.id}
            onPointerMove={() => selectAction(index)}
            onClick={() => onAction(action.id)}
          >
            <span className="action-glyph">{index === selectedIndex ? <CornerDownLeft /> : <Check />}</span>
            <span>{action.title}</span>
            {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
          </button>
        ))}
      </div>
    </aside>
  );
}
