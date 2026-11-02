import React from 'react';
import type { PasswordEntry } from '~/passwords/model';
import type { TransientBlockActions } from '../Builder/TransientBlockHost';
import { PasswordPanelDocument } from './PasswordPanelDocument';
import { passwordSourceBlocks } from './passwordPanelBlocks';

type Props = { ownerId: string; entryId: string; entry: PasswordEntry };
export function PasswordSource(props: Props) {
  return <PasswordSourceScope key={`${props.ownerId}:${props.entryId}`} {...props} />;
}
function PasswordSourceScope({ ownerId, entryId, entry }: Props) {
  const source = React.useMemo(() => { try { return JSON.parse(entry.onePassword || '{}'); } catch { return {}; } }, [entry.onePassword]);
  const context = React.useMemo(() => { try { return JSON.parse(entry.onePasswordContext || '{}'); } catch { return {}; } }, [entry.onePasswordContext]);
  const history = Array.isArray(source?.details?.passwordHistory) ? source.details.passwordHistory : [];
  const [showItem, setShowItem] = React.useState(false), [showContext, setShowContext] = React.useState(false);
  const [revealed, setRevealed] = React.useState<Set<number>>(() => new Set());
  const scopeKey = `${typeof window === 'undefined' ? '' : window.location.origin}:${ownerId}:${entryId}`;
  React.useEffect(() => {
    const clear = () => { setShowItem(false); setShowContext(false); setRevealed(new Set()); };
    const hidden = () => { if (document.visibilityState !== 'visible') clear(); };
    window.addEventListener('blur', clear); window.addEventListener('pagehide', clear);
    window.addEventListener('thingtime:hide-vault-values', clear); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('blur', clear); window.removeEventListener('pagehide', clear); window.removeEventListener('thingtime:hide-vault-values', clear); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  const actions: TransientBlockActions = {
    'source.item': ({ signal }) => { signal.throwIfAborted(); setShowItem(value => !value); },
    'source.context': ({ signal }) => { signal.throwIfAborted(); setShowContext(value => !value); },
    'source.history': ({ inputs, signal }) => {
      signal.throwIfAborted(); const index = Number(inputs.index);
      if (!Number.isSafeInteger(index) || index < 0 || index >= history.length) return;
      setRevealed(previous => { const next = new Set(previous); if (next.has(index)) next.delete(index); else next.add(index); return next; });
    }
  };
  const readValue = (name: string) => {
    if (name === 'sourceAccount') return String(context?.account?.accountName || context?.account?.name || context?.account?.uuid || '');
    if (name === 'sourceVault') return String(context?.vault?.name || context?.vault?.uuid || '');
    if (name === 'sourceItem') return showItem ? entry.onePassword || '' : '';
    if (name === 'sourceContext') return showContext ? entry.onePasswordContext || '' : '';
    const match = /^history-(value|time)-(\d+)$/.exec(name); if (!match) return undefined;
    const index = Number(match[2]), item = history[index]; if (!item) return undefined;
    if (match[1] === 'time') return Number.isFinite(item.time) ? new Date(item.time * 1000).toLocaleString() : `Previous password ${index + 1}`;
    return typeof item.value === 'string' ? item.value : JSON.stringify(item.value) || '';
  };
  return <PasswordPanelDocument documentKey="password-source" title="Password source layout" scopeKey={scopeKey}
    blocks={passwordSourceBlocks} actions={actions} readValue={readValue} scope={{ source: {
      hasAccount: !!context?.account, hasVault: !!context?.vault, hasHistory: !!history.length, historyCount: history.length,
      showItem, showContext, itemRevealLabel: showItem ? 'Hide original item' : 'Reveal original item', contextRevealLabel: showContext ? 'Hide original account and vault' : 'Reveal original account and vault',
      history: history.map((_item: unknown, index: number) => ({ index, labelName: `history-time-${index}`, valueName: `history-value-${index}`, inputType: revealed.has(index) ? 'text' : 'password', revealLabel: revealed.has(index) ? 'Hide previous password' : 'Reveal previous password' }))
    } }} />;
}
