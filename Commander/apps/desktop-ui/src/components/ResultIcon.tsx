import { useEffect, useState } from 'react';
import type { SearchItemKind } from '@commander/protocol';
import { cachedNativeFileIcon, requestNativeFileIcon } from '../lib/nativeFileIcons.js';
import { CommanderIcon } from './CommanderIcon.js';

export function ResultIcon({
  icon,
  kind,
  path,
  shouldLoadNativeIcon = false,
  nativeIconPriority = 100,
}: {
  icon?: string | undefined;
  kind: SearchItemKind;
  path?: string | undefined;
  shouldLoadNativeIcon?: boolean | undefined;
  nativeIconPriority?: number | undefined;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(() =>
    path ? (cachedNativeFileIcon(path) ?? null) : null,
  );

  useEffect(() => {
    let active = true;
    if (!path) {
      setDataUrl(null);
      return () => {
        active = false;
      };
    }
    const cached = cachedNativeFileIcon(path);
    setDataUrl(cached ?? null);
    if (!shouldLoadNativeIcon || cached !== undefined) {
      return () => {
        active = false;
      };
    }
    const request = requestNativeFileIcon(path, nativeIconPriority);
    void request.promise.then((next) => {
      if (active) setDataUrl(next);
    });
    return () => {
      active = false;
      request.cancel();
    };
  }, [nativeIconPriority, path, shouldLoadNativeIcon]);

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
