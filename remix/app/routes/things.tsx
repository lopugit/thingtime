import { useSearchParams } from 'react-router';
import { ErrorLogsPage } from '~/components/Things/ErrorLogsPage';
import { ThingsPage } from '~/components/Things/ThingsPage';

export default function Things() {
  const [params] = useSearchParams();
  return params.get('logs') === '1' ? <ErrorLogsPage /> : <ThingsPage />;
}
