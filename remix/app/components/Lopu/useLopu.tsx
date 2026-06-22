import { useCallback } from 'react';
import { Box, Flex, Text, useToast } from '@chakra-ui/react';

// 🦄 Lopu — the Thingtime AI. A minimal, modern toast: a rainbow gradient
// "unicorn vomit" border around a clean white card, shown as a little message
// from Lopu, below the fixed nav.

const RAINBOW = 'linear-gradient(120deg, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6)';

type LopuStatus = 'success' | 'error' | 'info';

type LopuLink = { label: string; href: string };

type LopuArgs = {
  title?: string;
  description?: string;
  status?: LopuStatus;
  duration?: number;
  link?: LopuLink;
};

const statusEmoji = (status?: LopuStatus) => (status === 'success' ? '✨ ' : status === 'error' ? '🌧️ ' : '');

const LopuToast = ({ title, description, status, link, onClose }: LopuArgs & { onClose: () => void }) => (
  <Box
    role="status"
    pointerEvents="auto"
    p="2px"
    borderRadius="20px"
    backgroundImage={RAINBOW}
    boxShadow="0 10px 34px rgba(0,0,0,0.14)"
    width="360px"
    maxWidth="calc(100vw - 24px)"
  >
    <Box bg="white" borderRadius="18px" px={4} py={3}>
      <Flex align="center" gap={2} mb={title || description ? 1.5 : 0}>
        <Text fontSize="md" lineHeight={1}>
          🦄
        </Text>
        <Text
          fontWeight="800"
          fontSize="sm"
          backgroundImage={RAINBOW}
          sx={{ WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
        >
          Lopu
        </Text>
        <Text fontSize="10px" opacity={0.4} fontWeight="500">
          Thingtime AI
        </Text>
        <Box flex={1} />
        <Box
          as="button"
          type="button"
          onClick={onClose}
          aria-label="Close"
          fontSize="xs"
          lineHeight={1}
          color="gray.400"
          _hover={{ color: 'gray.700' }}
          transition="color 120ms"
        >
          ✕
        </Box>
      </Flex>

      {title && (
        <Text fontSize="sm" fontWeight="600" color="gray.800">
          {statusEmoji(status)}
          {title}
        </Text>
      )}
      {description && (
        <Text fontSize="xs" color="gray.500" mt="2px">
          {description}
        </Text>
      )}
      {link && (
        <Box
          as="a"
          href={link.href}
          mt={2}
          display="inline-block"
          fontSize="xs"
          fontWeight="700"
          color="purple.500"
          textDecoration="underline"
          wordBreak="break-all"
        >
          {link.label}
        </Box>
      )}
    </Box>
  </Box>
);

export const useLopu = () => {
  const toast = useToast();

  return useCallback(
    ({ title, description, status, duration = 5000, link }: LopuArgs) =>
      toast({
        duration,
        position: 'top',
        // A full-viewport flex container centers the card via flow (immune to the
        // ancestor-transform quirk that broke translateX(-50%) centering).
        // translateY offsets each toast below the nav *visually only* — it
        // doesn't affect layout, so Chakra's native tight stacking + slide/fade
        // animation is preserved (marginTop would compound into big gaps).
        // pointerEvents:none keeps the wide invisible container from eating
        // clicks (the card re-enables them).
        containerStyle: {
          transform: 'translateY(70px)',
          width: '100vw',
          maxWidth: '100vw',
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none'
        },
        render: ({ onClose }) => (
          <LopuToast title={title} description={description} status={status} link={link} onClose={onClose} />
        )
      }),
    [toast]
  );
};
