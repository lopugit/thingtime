import React from 'react';

type Props = {
  scopeKey: string;
  enabled?: boolean;
  /** Explicit allowlist lookup. Values never become block props or scope data. */
  readValue: (name: string) => string | boolean | undefined;
  children: React.ReactNode;
};

/** Populate only live, opted-in controls. Authored documents contain names, never
 * decrypted values. Remounting the boundary removes the browser's input state. */
export function TransientPrivateControls(props: Props) {
  return <PrivateControlsSession key={`${props.scopeKey}:${props.enabled !== false}`} {...props} />;
}

function PrivateControlsSession({ readValue, enabled = true, children }: Props) {
  const host = React.useRef<HTMLDivElement>(null);
  const current = React.useRef({ readValue, enabled });
  current.current = { readValue, enabled };
  const suspended = React.useRef(false);
  const controls = React.useCallback(() => Array.from(host.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[data-tt-private-control][name],textarea[data-tt-private-control][name]') || []), []);
  const clear = React.useCallback(() => { for (const field of controls()) { field.value = ''; if (field instanceof HTMLInputElement) field.checked = false; } }, [controls]);
  const hydrate = React.useCallback((restoreFocus = false) => {
    if (!current.current.enabled || suspended.current || document.visibilityState === 'hidden') { clear(); return; }
    const fields = controls();
    for (const field of fields) {
      if (field instanceof HTMLInputElement && field.type === 'file') continue;
      const value = fields.filter(other => other.name === field.name).length === 1 ? current.current.readValue(field.name) : undefined;
      if (value === undefined) { field.value = ''; continue; }
      if (typeof value === 'boolean' && field instanceof HTMLInputElement) field.checked = value;
      else if ((restoreFocus || field.readOnly || document.activeElement !== field) && field.value !== String(value)) field.value = String(value);
    }
  }, [clear, controls]);
  React.useLayoutEffect(() => hydrate());
  React.useLayoutEffect(() => {
    const root = host.current;
    const suspend = () => { suspended.current = true; clear(); };
    const resume = () => { suspended.current = false; hydrate(true); };
    const visibility = () => document.visibilityState === 'hidden' ? suspend() : resume();
    const observer = new MutationObserver(() => hydrate());
    if (root) observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('blur', suspend); window.addEventListener('focus', resume);
    window.addEventListener('pagehide', suspend); window.addEventListener('pageshow', resume);
    window.addEventListener('thingtime:hide-vault-values', suspend);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect(); clear();
      window.removeEventListener('blur', suspend); window.removeEventListener('focus', resume);
      window.removeEventListener('pagehide', suspend); window.removeEventListener('pageshow', resume);
      window.removeEventListener('thingtime:hide-vault-values', suspend);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [clear, hydrate]);
  return <div ref={host} data-tt-private-controls="" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) event.stopPropagation();
  }}>{children}</div>;
}
