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
        opacity: 0.6
      }}
      // allow no select
      userSelect={'none'}
      px={6}
      py={3}
      borderRadius={'10px'}
      bg="gray"
      {...props}
    >
      {props.children}
    </Box>
  );
};
