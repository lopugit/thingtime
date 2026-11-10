import { useEffect, useState } from 'react';
import type { SearchHit } from '@commander/protocol';
import { Check, CornerDownLeft } from 'lucide-react';

export function ActionsPanel({ item, onAction }: { item: SearchHit; onAction(id: string): void }) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [item.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelectedIndex((current) => Math.min(item.actions.length - 1, current + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelectedIndex((current) => Math.max(0, current - 1));
      } else if (event.key === 'Enter' && item.actions[selectedIndex]) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onAction(item.actions[selectedIndex]!.id);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [item.actions, onAction, selectedIndex]);

  return (
    <aside className="actions-panel" aria-label={`Actions for ${item.title}`}>
      <header>Actions</header>
      <div className="actions-list" role="menu">
        {item.actions.map((action, index) => (
          <button
            type="button"
            role="menuitem"
            className={index === selectedIndex ? 'action-row selected' : 'action-row'}
            key={action.id}
            onMouseEnter={() => setSelectedIndex(index)}
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
