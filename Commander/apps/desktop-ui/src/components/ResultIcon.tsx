import { useEffect, useState } from 'react';
import type { SearchItemKind } from '@commander/protocol';
import { nativeRequest } from '../lib/nativeBridge.js';
import { CommanderIcon } from './CommanderIcon.js';

const maximumCachedIcons = 256;
const iconCache = new Map<string, string | null>();
const pendingIcons = new Map<string, Promise<string | null>>();

interface NativeFileIconResult {
  dataUrl?: string;
}

function rememberIcon(path: string, dataUrl: string | null): string | null {
  iconCache.delete(path);
  iconCache.set(path, dataUrl);
  while (iconCache.size > maximumCachedIcons) {
    const oldest = iconCache.keys().next().value;
    if (typeof oldest !== 'string') break;
    iconCache.delete(oldest);
  }
  return dataUrl;
}

function loadIcon(path: string): Promise<string | null> {
  const cached = iconCache.get(path);
  if (cached !== undefined || iconCache.has(path)) return Promise.resolve(cached ?? null);

  const pending = pendingIcons.get(path);
  if (pending) return pending;

  const request = nativeRequest<NativeFileIconResult>('filesystem.icon', { path })
    .then((result) =>
      rememberIcon(
        path,
        typeof result?.dataUrl === 'string' && result.dataUrl.startsWith('data:image/png;base64,')
          ? result.dataUrl
          : null,
      ),
    )
    .catch(() => rememberIcon(path, null))
    .finally(() => pendingIcons.delete(path));
  pendingIcons.set(path, request);
  return request;
}

export function ResultIcon({
  icon,
  kind,
  path,
}: {
  icon?: string | undefined;
  kind: SearchItemKind;
  path?: string | undefined;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(() => (path ? (iconCache.get(path) ?? null) : null));

  useEffect(() => {
    let active = true;
    if (!path) {
      setDataUrl(null);
      return () => {
        active = false;
      };
    }
    setDataUrl(iconCache.get(path) ?? null);
    void loadIcon(path).then((next) => {
      if (active) setDataUrl(next);
    });
    return () => {
      active = false;
    };
  }, [path]);

  return (
    <span
      className={`result-icon kind-${kind}${path ? ' path-backed-icon' : ''}${dataUrl ? ' native-file-icon' : ''}`}
    >
      {dataUrl ? (
        <img className="result-native-icon" src={dataUrl} alt="" draggable={false} />
      ) : (
        <CommanderIcon name={icon} kind={kind} />
      )}
    </span>
  );
}
