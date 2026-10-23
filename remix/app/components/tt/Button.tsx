import { Box } from '@chakra-ui/react';
import { useThingtime } from '../Thingtime/useThingtime';

export const Button = (props: any = {}) => {
  const { thingtime } = useThingtime();

  const animationSpeed = thingtime?.settings?.animationSpeed || '200ms';

  return (
    <Box
      cursor={'pointer'}
      transition={`all ${animationSpeed}`}
      _hover={{
        background: 'var(--tt-surface-hover, #ececee)'
      }}
      // allow no select
      userSelect={'none'}
      px={6}
      py={3}
      borderRadius={'var(--tt-radius-md, 12px)'}
      bg="var(--tt-surface-alt, #f5f5f7)"
      color="var(--tt-ink, #16161a)"
      fontWeight={600}
      {...props}
    >
      {props.children}
    </Box>
  );
};
