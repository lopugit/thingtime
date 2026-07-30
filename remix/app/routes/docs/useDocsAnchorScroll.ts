import React from 'react';
import { useLocation } from 'react-router';

// Scrolls a docs page to the element named by location.hash so search results
// can deep-link sections (mirrors SchemasPage). The rAF defers past
// DocsLayout's scroll-to-top-on-pathname-change effect.
export const useDocsAnchorScroll = () => {
  const { hash } = useLocation();

  React.useEffect(() => {
    if (!hash) return;

    const targetId = decodeURIComponent(hash.slice(1));

    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    });
  }, [hash]);
};
