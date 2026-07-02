import {
  Badge,
  Box,
  Flex,
  Grid,
  Heading,
  Icon,
  Link as ChakraLink,
  Stack,
  Text
} from '@chakra-ui/react';
import { BookOpen, Boxes, ChevronRight } from 'lucide-react';
import { Link as RouterLink, Outlet, useLocation } from 'react-router';

const docsNav = [
  {
    label: 'Overview',
    to: '/docs',
    icon: BookOpen,
    description: 'Docs home'
  },
  {
    label: 'Design mockups',
    to: '/docs/design',
    icon: Boxes,
    description: 'PR #25 previews'
  }
];

const isActivePath = (pathname: string, to: string) => {
  if (to === '/docs') {
    return pathname === '/docs';
  }

  return pathname === to || pathname.startsWith(`${to}/`);
};

export default function DocsLayout() {
  const { pathname } = useLocation();

  return (
    <Box bg="#f7f7f5" color="#1f2933" minH="100vh" w="100%" pt={{ base: '88px', md: '96px' }}>
      <Grid
        templateColumns={{ base: '1fr', lg: '260px minmax(0, 1fr)' }}
        columnGap={{ base: 0, lg: 8 }}
        maxW="1480px"
        mx="auto"
        px={{ base: 4, md: 6, xl: 8 }}
        pb={16}
        w="100%"
      >
        <Box
          as="aside"
          borderRight={{ base: '0', lg: '1px solid' }}
          borderColor="blackAlpha.200"
          pr={{ base: 0, lg: 6 }}
          pb={{ base: 6, lg: 0 }}
        >
          <Box position={{ base: 'relative', lg: 'sticky' }} top="96px">
            <Flex align="center" gap={2} mb={6}>
              <Text fontSize="xs" fontWeight="700" letterSpacing="0" textTransform="uppercase" color="gray.500">
                Thingtime
              </Text>
              <Badge bg="#d7f5df" color="#0f5132" borderRadius="sm" px={2}>
                Docs
              </Badge>
            </Flex>

            <Heading as="h1" fontSize="lg" lineHeight="1.2" mb={5}>
              API-style reference
            </Heading>

            <Stack spacing={1}>
              {docsNav.map((item) => {
                const active = isActivePath(pathname, item.to);

                return (
                  <ChakraLink
                    key={item.to}
                    as={RouterLink}
                    to={item.to}
                    _hover={{ textDecoration: 'none', bg: 'blackAlpha.50' }}
                    bg={active ? 'white' : 'transparent'}
                    borderLeft="3px solid"
                    borderColor={active ? '#008060' : 'transparent'}
                    color={active ? '#111827' : 'gray.700'}
                    display="block"
                    px={3}
                    py={2.5}
                  >
                    <Flex align="center" gap={3} minW={0}>
                      <Icon as={item.icon} boxSize={4} flexShrink={0} />
                      <Box minW={0}>
                        <Text fontSize="sm" fontWeight="650" lineHeight="1.25">
                          {item.label}
                        </Text>
                        <Text fontSize="xs" color="gray.500" lineHeight="1.25">
                          {item.description}
                        </Text>
                      </Box>
                      <Icon as={ChevronRight} boxSize={3.5} ml="auto" opacity={active ? 1 : 0.25} />
                    </Flex>
                  </ChakraLink>
                );
              })}
            </Stack>
          </Box>
        </Box>

        <Box as="main" minW={0}>
          <Outlet />
        </Box>
      </Grid>
    </Box>
  );
}
