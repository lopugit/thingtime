import { PageShell } from '../components/Layout/PageShell';
import { Raw } from '~/components/MongoDB/Raw';

export default function RawPage() {
  const template = (
    <PageShell width={1400} columnProps={{ rowGap: 8, minWidth: 0 }}>
      <Raw />
    </PageShell>
  );

  return template;
}
