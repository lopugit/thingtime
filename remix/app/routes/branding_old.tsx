import { Box } from '@chakra-ui/react';
import { Branding } from '~/components/Branding/Branding';
import { TopSpacing } from '~/components/Layout/TopSpacing';
import { Raw } from '~/components/MongoDB/Raw';
import { RawResults } from '~/components/MongoDB/RawResults';

export default function branding() {
  const template = (
    <>
      <Branding />
    </>
  );

  return template;
}
