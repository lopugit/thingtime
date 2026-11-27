import React from 'react';
import { Button, Flex, Spinner, Text } from '@chakra-ui/react';
import { Link, useNavigate } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { PageShell } from '../Layout/PageShell';
import { resolveBuilderAppEntryPoint } from './builderAppNavigation';

export function BuilderAppEntryPoint({ id }: { id: string }) {
  const user = useCurrentUser();
  const plane = useDataPlane();
  return <EntryPoint key={JSON.stringify([id, user?.id, plane])} id={id} />;
}

function EntryPoint({ id }: { id: string }) {
  const api = useApi();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const navigate = useNavigate();
  const [error, setError] = React.useState('');
  const [attempt, retry] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => {
    const controller = new AbortController();
    setError('');
    resolveBuilderAppEntryPoint(id, target => apiRef.current.v1.things.get({ id: target }, { signal: controller.signal }))
      .then(href => { if (!controller.signal.aborted) navigate(href, { replace: true }); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The app could not be opened.'); });
    return () => controller.abort();
  }, [id, navigate, attempt]);
  return <PageShell width={920}><Flex alignItems="center" gap={3} wrap="wrap">
    {error ? <Text role="alert">{error}</Text> : <Flex role="status" alignItems="center" gap={2}><Spinner size="sm" aria-hidden="true" /><Text>Opening app</Text></Flex>}
    {error && <Button onClick={retry} size="sm">Retry</Button>}
    <Button as={Link} to={`/builder?folder=${encodeURIComponent(id)}&kind=all`} variant="outline" size="sm">Browse app</Button>
    <Button as={Link} to="/builder?kind=apps" variant="ghost" size="sm">All apps</Button>
  </Flex></PageShell>;
}
