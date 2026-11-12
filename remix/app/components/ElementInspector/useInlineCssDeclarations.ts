import React from 'react';

import { applyInlineCssDeclarations } from './cssDeclarations';

export function useInlineCssDeclarations(
 ref: React.RefObject<HTMLElement>, declarations: Record<string, string> | undefined,
 mapValue?: (value: string) => string
) {
 // Reconcile after the host's own style/DOM update, including when the same
 // block renders through another component or its editor-only props change.
 React.useLayoutEffect(() => {
  if (ref.current && declarations) return applyInlineCssDeclarations(ref.current, declarations, mapValue);
 });
}
