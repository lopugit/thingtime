import React from 'react';
import { HtmlBlockElement } from '../Kinds/HtmlThingRenderer';
import { CONNECTION_ICON_FALLBACK, connectionIconUrl } from '~/connections/providerIcons';

export function ConnectionProviderIcon({ provider, enabled }: { provider: string; enabled: boolean }) {
  return <HtmlBlockElement tag="img" attributes={{
    src: connectionIconUrl(provider, enabled), alt: '', 'aria-hidden': true, width: 24, height: 24,
    'data-tt-image-fallback': CONNECTION_ICON_FALLBACK,
  }} editorProps={{ style: { width: 24, height: 24, flex: '0 0 24px', objectFit: 'contain' } }} />;
}
