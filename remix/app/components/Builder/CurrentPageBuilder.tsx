import React from 'react';
import { IconButton } from '@chakra-ui/react';
import { Blocks } from 'lucide-react';
import { useLocation } from 'react-router';

const CurrentPageBuilder = React.createContext({
  active: false,
  toggle: () => {}
});

/** The root remounts this provider on account changes. Search and hash changes
 * belong to the same page and keep the active editing session. */
export function CurrentPageBuilderProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const [page, setPage] = React.useState({ pathname, active: false });
  if (page.pathname !== pathname) setPage({ pathname, active: false });

  const active = page.pathname === pathname && page.active;
  const toggle = React.useCallback(() => setPage({ pathname, active: !active }), [pathname, active]);
  const value = React.useMemo(() => ({ active, toggle }), [active, toggle]);
  return <CurrentPageBuilder.Provider value={value}>{children}</CurrentPageBuilder.Provider>;
}

export function useCurrentPageBuilder() {
  return React.useContext(CurrentPageBuilder);
}

export function CurrentPageBuilderToggle({ onToggle }: { onToggle?: () => void }) {
  const { active, toggle } = useCurrentPageBuilder();
  return <IconButton
    icon={<Blocks size={16} />}
    aria-label="Builder on current page"
    title="Builder on current page"
    aria-pressed={active}
    variant={active ? 'solid' : 'ghost'}
    size="sm"
    flexShrink={0}
    onClick={() => { toggle(); onToggle?.(); }}
  />;
}
