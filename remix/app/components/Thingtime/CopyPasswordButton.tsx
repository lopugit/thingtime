import React from 'react';
import { Button, Text } from '@chakra-ui/react';
import { activityEvents } from '~/activity/activityManager';

/** Copies only an already-authorized controlled draft. Never reads the clipboard. */
export function CopyPasswordButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = React.useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const statusId = React.useId();
  const lifecycle = React.useRef({ generation: 0, pending: false });
  React.useEffect(() => {
    const state = lifecycle.current;
    const clear = () => { state.generation++; state.pending = false; setStatus('idle'); };
    clear();
    const events = activityEvents(window, 'events:components/Thingtime/CopyPasswordButton', 'Copy password');
    for (const name of ['blur', 'thingtime:hide-vault-values', 'thingtime:mask-vault-values']) events.addEventListener(name, clear);
    return () => {
      state.generation++; state.pending = false;
      for (const name of ['blur', 'thingtime:hide-vault-values', 'thingtime:mask-vault-values']) events.removeEventListener(name, clear);
    };
  }, [value]);
  const copy = async () => {
    if (!value || lifecycle.current.pending) return;
    const version = lifecycle.current.generation;
    lifecycle.current.pending = true; setStatus('copying');
    try {
      // Invoke directly during the click/keyboard activation, preserving the
      // browser's user gesture. Exceptions must never include credential text.
      await navigator.clipboard.writeText(value);
      if (version === lifecycle.current.generation) setStatus('copied');
    } catch {
      if (version === lifecycle.current.generation) setStatus('failed');
    } finally {
      if (version === lifecycle.current.generation) lifecycle.current.pending = false;
    }
  };
  return <>
    <Button type="button" size="sm" variant="outline" flexShrink={0} aria-label={`Copy ${label}`} aria-describedby={statusId} isDisabled={!value || status === 'copying'} onClick={() => void copy()}>Copy</Button>
    <Text id={statusId} role="status" aria-live="polite" fontSize="xs" flexBasis="100%" overflowWrap="anywhere" color={status === 'failed' ? 'red.600' : undefined}>{status === 'copied' ? 'Copied' : status === 'failed' ? 'Could not copy. Allow clipboard access and try again.' : ''}</Text>
  </>;
}
