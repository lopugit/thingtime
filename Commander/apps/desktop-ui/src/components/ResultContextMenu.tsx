import { useEffect, useRef } from 'react';
import type { SearchHit } from '@commander/protocol';
import { Check, Trash2 } from 'lucide-react';

export function ResultContextMenu({
  item,
  x,
  y,
  onAction,
  onDismiss,
}: {
  item: SearchHit;
  x: number;
  y: number;
  onAction(id: string): void;
  onDismiss(): void;
}) {
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dismissPointer = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    const dismissKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('pointerdown', dismissPointer, true);
    window.addEventListener('keydown', dismissKey, true);
    window.addEventListener('blur', onDismiss);
    return () => {
      window.removeEventListener('pointerdown', dismissPointer, true);
      window.removeEventListener('keydown', dismissKey, true);
      window.removeEventListener('blur', onDismiss);
    };
  }, [onDismiss]);

  return (
    <aside
      ref={menuRef}
      className="result-context-menu"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 292)),
        top: Math.max(8, Math.min(y, window.innerHeight - 350)),
      }}
      aria-label={`Context actions for ${item.title}`}
    >
      <header>
        {item.kind === 'application' ? 'Application' : item.kind === 'directory' ? 'Folder' : 'File'} Actions
      </header>
      <div role="menu">
        {item.actions.map((action) => {
          const destructive = action.id === 'delete' || action.id === 'move-to-trash';
          return (
            <button
              type="button"
              role="menuitem"
              className={destructive ? 'context-action destructive' : 'context-action'}
              key={action.id}
              onClick={() => {
                onAction(action.id);
                onDismiss();
              }}
            >
              <span>{destructive ? <Trash2 /> : <Check />}</span>
              <span>{action.title}</span>
              {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
