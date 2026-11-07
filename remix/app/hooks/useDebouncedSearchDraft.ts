import React from 'react';
import { useLocation, useNavigationType, useSearchParams } from 'react-router';
import { UrlSearchDraft, withSearchQuery } from './urlSearchDraft';

const STATE_KEY = '__thingtimeSearchDraft';
const normalizeSearch = (value: string) => value.replace(/\s+/g, ' ').trim();

/** URL remains committed truth, while a delayed local echo cannot erase typing. */
export const useDebouncedSearchDraft = (name: string, value: string, delay = 300) => {
  const location = useLocation();
  const navigation = useNavigationType();
  const [, setSearchParams] = useSearchParams();
  const id = React.useId();
  const sequence = React.useRef(0);
  const [controller] = React.useState(() => new UrlSearchDraft(value, normalizeSearch));
  const [draft, setDraft] = React.useState(value);
  const latest = React.useRef({ location, setSearchParams });
  latest.current = { location, setSearchParams };

  React.useLayoutEffect(() => {
    setDraft(controller.observe(value, location.state?.[STATE_KEY], navigation));
  }, [controller, value, location.key, location.state, navigation]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const token = `${id}:${++sequence.current}`;
      const next = controller.commit(token);
      if (next === null) return;
      const current = latest.current;
      current.setSearchParams(withSearchQuery(current.location.search, name, next), {
        replace: true, state: { ...current.location.state, [STATE_KEY]: token }
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [controller, draft, name, delay, id, location.key]);

  const edit = React.useCallback((next: string) => {
    controller.edit(next);
    setDraft(next);
  }, [controller]);
  return [draft, edit] as const;
};
