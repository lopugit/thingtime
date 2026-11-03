import React from 'react';
import { PASSWORD_BRAND_ICON } from './passwordBrandingBlocks';

/** Decorative provider branding; site/entry icons keep their independent meaning. */
export function PasswordBrandMark({ size = 32 }: { size?: number }) {
  return <img src={PASSWORD_BRAND_ICON} width={size} height={size} alt="" aria-hidden="true"
    style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, imageRendering: 'pixelated' }} />;
}
