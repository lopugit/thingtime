import React from 'react';
import { Box } from '@chakra-ui/react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { passwordIconBlocks } from './passwordIconBlocks';
import { openPasswordIconBlob } from '~/passwords/icons.client';
import { PASSWORD_ICON_MIME_TYPES, passwordIconUrl, passwordWebsiteIcon, type PasswordIcon } from '~/passwords/icons';
import { uploadPasswordFile } from '~/passwords/files.client';
import { newPasswordFile } from '~/passwords/fileCrypto';

export function PasswordEntryIcon({ ownerId, entryId, icon, size = 32 }: { ownerId: string; entryId: string; icon?: PasswordIcon; size?: number }) {
  const scope = `${ownerId}:${entryId}:${JSON.stringify(icon)}`;
  const [image, setImage] = React.useState<{ scope: string; url: string } | null>(null);
  const [failed, setFailed] = React.useState('');
  React.useEffect(() => {
    if (!icon) return;
    const controller = new AbortController(); let url = '';
    openPasswordIconBlob(ownerId, entryId, icon, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setImage({ scope, url });
    }).catch(() => { if (!controller.signal.aborted) setFailed(scope); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [scope, ownerId, entryId, icon]);
  const src = image?.scope === scope && failed !== scope ? image.url : '';
  return <Box width={`${size}px`} height={`${size}px`} flexShrink={0} display="grid" placeItems="center" borderRadius="6px" background="var(--tt-muted, #f3f3f5)" overflow="hidden" aria-hidden="true">
    {src ? <img src={src} width={size} height={size} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={() => setFailed(scope)} /> : <svg width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>}
  </Box>;
}

export function PasswordIconEditor(props: { ownerId: string; entryId: string; saved: boolean; icon?: PasswordIcon; website?: string; disabled?: boolean; onChange: (icon: PasswordIcon | undefined) => void; onBusyChange?: (busy: boolean) => void }) {
  return <PasswordIconEditorScope key={`${props.ownerId}:${props.entryId}`} {...props} />;
}
function PasswordIconEditorScope({ ownerId, entryId, saved, icon, website = '', disabled = false, onChange, onBusyChange }: Parameters<typeof PasswordIconEditor>[0]) {
  const [showUrl, setShowUrl] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const active = React.useRef(true), pending = React.useRef(false);
  const current = React.useRef({ onChange, onBusyChange }); current.current = { onChange, onBusyChange };
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const scopeKey = `${ownerId}:${entryId}`;
  const actions: TransientBlockActions = {
    'icon.show-url': () => setShowUrl(value => !value),
    'icon.type-url': () => {}, // Kept exclusively in this transient input's DOM.
    'icon.use-url': ({ readField }) => { if (!disabled && !pending.current) { try { onChange({ kind: 'url', url: passwordIconUrl(readField('icon-url')) }); setError(''); } catch (cause) { setError((cause as Error).message); } } },
    'icon.website': () => { if (!disabled && !pending.current) { try { onChange(passwordWebsiteIcon(website)); setError(''); } catch { setError('Enter a valid HTTPS website first.'); } } },
    'icon.remove': () => { if (!disabled && !pending.current) { onChange(undefined); setError(''); } },
    'icon.upload': async ({ readFile, signal }) => {
      if (disabled || pending.current || !saved) return;
      const file = readFile('icon-file'); if (!file) return;
      if (!PASSWORD_ICON_MIME_TYPES.includes(file.type) || !/\.(png|jpe?g|webp|gif|ico)$/i.test(file.name)) { setError('Choose a PNG, JPEG, WebP, GIF, or ICO image.'); return; }
      pending.current = true; setBusy(true); onBusyChange?.(true); setError('');
      try {
        const metadata = { ...newPasswordFile(file.name, file.size), role: 'icon' as const };
        const uploaded = await uploadPasswordFile(ownerId, entryId, metadata, () => file.stream(), signal);
        if (active.current && !signal.aborted) current.current.onChange({ kind: 'attachment', fileId: uploaded.id });
      } catch { if (active.current && !signal.aborted) setError('Icon upload failed. Choose the file again to retry.'); }
      finally { pending.current = false; if (active.current) { setBusy(false); current.current.onBusyChange?.(false); } }
    }
  };
  return <Box mt={4}><SettingsDocumentHost documentKey="password-entry-icon" defaultDocument={passwordIconBlocks} scopeKey={scopeKey} title="Entry icon layout" layoutEditingDisabled={busy}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={{ icon: { showUrl, busy: busy || disabled, cannotUpload: busy || disabled || !saved, unsaved: !saved, cannotWebsite: busy || disabled || !website, cannotRemove: busy || disabled || !icon, error } }} actions={actions} enabled={!editing} onError={() => setError('The icon could not be changed.')}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost></Box>;
}
