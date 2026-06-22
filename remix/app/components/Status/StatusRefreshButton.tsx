import React from 'react';
import { Box } from '@chakra-ui/react';
import { RefreshCw } from 'lucide-react';

export const StatusRefreshButton = ({
  isLoading,
  label,
  onRefresh
}: {
  isLoading?: boolean;
  label: string;
  onRefresh: () => void;
}) => {
  return (
    <Box
      as="button"
      type="button"
      aria-label={label}
      title={label}
      width="14px"
      height="14px"
      minWidth="14px"
      border="1px solid"
      borderColor="rgba(160, 174, 192, 0.45)"
      borderRadius="full"
      backgroundColor="rgba(247, 250, 252, 0.85)"
      color="#718096"
      cursor="pointer"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      fontSize="9px"
      lineHeight="1"
      opacity={isLoading ? 0.55 : 1}
      padding={0}
      transition="opacity 120ms ease, transform 120ms ease, border-color 120ms ease"
      _hover={{
        borderColor: '#A0AEC0',
        opacity: 0.8
      }}
      _active={{
        transform: 'rotate(35deg) scale(0.95)'
      }}
    >
      <RefreshCw aria-hidden="true" size={9} strokeWidth={2} />
    </Box>
  );
};
