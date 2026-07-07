import React from 'react';
import { Box } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { RefreshCw } from 'lucide-react';

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export const StatusRefreshButton = ({
  isLoading,
  label,
  onRefresh
}: {
  isLoading?: boolean;
  label: string;
  onRefresh: () => void;
}) => {
  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onRefresh();
    },
    [onRefresh]
  );

  return (
    <Box
      as="button"
      type="button"
      aria-label={label}
      title={label}
      onClick={handleClick}
      width="14px"
      height="14px"
      minWidth="14px"
      border="1px solid"
      borderColor="var(--tt-border, rgba(160, 174, 192, 0.45))"
      borderRadius="full"
      backgroundColor="var(--tt-surface, rgba(247, 250, 252, 0.85))"
      color="var(--tt-muted, #718096)"
      cursor="pointer"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      fontSize="9px"
      lineHeight="1"
      opacity={isLoading ? 0.55 : 1}
      padding={0}
      transition="opacity 140ms ease, transform 140ms ease, border-color 140ms ease"
      _hover={{
        borderColor: 'var(--tt-muted, #A0AEC0)',
        opacity: 0.8
      }}
      _active={{
        transform: 'rotate(35deg) scale(0.95)'
      }}
    >
      <RefreshCw
        aria-hidden="true"
        size={9}
        strokeWidth={2}
        style={isLoading ? { animation: `${spin} 700ms linear infinite` } : undefined}
      />
    </Box>
  );
};
