import { Box } from '@chakra-ui/react';
import { TopSpacing } from '~/components/Layout/TopSpacing';
import { Raw } from '~/components/MongoDB/Raw';
import { RawResults } from '~/components/MongoDB/RawResults';

export default function login() {
  const template = (
    <>
      <TopSpacing />
      <Raw></Raw>
      <RawResults></RawResults>
    </>
  );

  return template;
}
