import {
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Grid,
  Heading,
  Icon,
  Link as ChakraLink,
  SimpleGrid,
  Stack,
  Text
} from '@chakra-ui/react';
import { ArrowRight, Boxes, FileCode2 } from 'lucide-react';
import { Link as RouterLink } from 'react-router';

import { designEntries } from './designEntries';

const referenceLinks = [
  { label: 'Design mockups', to: '/docs/design', detail: `${designEntries.length} standalone bundles` },
  { label: 'Static bundle browser', to: '/docs/design-bundles', detail: `${designEntries.length} HTML bundles` }
];

export default function DocsIndex() {
  return (
    <Grid templateColumns={{ base: '1fr', '2xl': 'minmax(0, 1fr) 260px' }} columnGap={8} rowGap={8}>
      <Stack spacing={8} minW={0}>
        <Box borderBottom="1px solid" borderColor="blackAlpha.200" pb={8}>
          <Flex align="center" gap={2} mb={4} wrap="wrap">
            <Badge bg="#d7f5df" color="#0f5132" borderRadius="sm" px={2}>
              Docs
            </Badge>
            <Text color="gray.500" fontSize="sm" fontFamily="mono">
              /docs
            </Text>
          </Flex>

          <Heading as="h2" fontSize={{ base: '3xl', md: '5xl' }} letterSpacing="0" lineHeight="1.02" maxW="760px">
            Thingtime documentation
          </Heading>
          <Text color="gray.600" fontSize={{ base: 'md', md: 'lg' }} lineHeight="1.7" mt={5} maxW="760px">
            A browser documentation surface for product reference pages and design artifacts.
          </Text>
        </Box>

        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
          <Box id="design-browser" bg="white" border="1px solid" borderColor="blackAlpha.200" borderRadius="md" p={5}>
            <Flex align="center" gap={3} mb={4}>
              <Icon as={Boxes} boxSize={5} color="#008060" />
              <Heading as="h3" fontSize="lg">
                Design browser
              </Heading>
            </Flex>
            <Text color="gray.600" fontSize="sm" lineHeight="1.6" mb={5}>
              Navigate the design exports, load each standalone HTML bundle, and open multiple previews at once.
            </Text>
            <Button
              as={RouterLink}
              to="/docs/design"
              size="sm"
              bg="#008060"
              color="white"
              _hover={{ bg: '#006e52' }}
              rightIcon={<Icon as={ArrowRight} boxSize={4} />}
            >
              Browse mockups
            </Button>
          </Box>

          <Box id="static-bundles" bg="white" border="1px solid" borderColor="blackAlpha.200" borderRadius="md" p={5}>
            <Flex align="center" gap={3} mb={4}>
              <Icon as={FileCode2} boxSize={5} color="#5c6ac4" />
              <Heading as="h3" fontSize="lg">
                Static bundle browser
              </Heading>
            </Flex>
            <Text color="gray.600" fontSize="sm" lineHeight="1.6" mb={5}>
              Browse every generated HTML bundle in a dedicated docs view without crowding the overview page.
            </Text>
            <Button
              as={RouterLink}
              to="/docs/design-bundles"
              size="sm"
              variant="outline"
              borderColor="blackAlpha.300"
              rightIcon={<Icon as={ArrowRight} boxSize={4} />}
            >
              Browse bundles
            </Button>
          </Box>
        </SimpleGrid>

        <Box bg="white" border="1px solid" borderColor="blackAlpha.200" borderRadius="md" overflow="hidden">
          <Box px={5} py={4}>
            <Heading as="h3" fontSize="lg">
              Reference map
            </Heading>
          </Box>
          <Divider />
          <Stack spacing={0}>
            {referenceLinks.map((item) => (
              <ChakraLink
                key={item.to}
                as={RouterLink}
                to={item.to}
                _hover={{ textDecoration: 'none', bg: 'blackAlpha.50' }}
                px={5}
                py={4}
              >
                <Flex align="center" gap={4}>
                  <Box minW={0}>
                    <Text fontWeight="650">{item.label}</Text>
                    <Text color="gray.500" fontSize="sm" fontFamily="mono" overflowWrap="anywhere">
                      {item.detail}
                    </Text>
                  </Box>
                  <Icon as={ArrowRight} boxSize={4} ml="auto" />
                </Flex>
              </ChakraLink>
            ))}
          </Stack>
        </Box>
      </Stack>

      <Box as="aside" display={{ base: 'none', '2xl': 'block' }} borderLeft="1px solid" borderColor="blackAlpha.200" pl={6}>
        <Box position="sticky" top="96px">
          <Text fontSize="xs" fontWeight="700" color="gray.500" textTransform="uppercase" mb={4}>
            On this page
          </Text>
          <Stack spacing={3} fontSize="sm">
            <ChakraLink href="#design-browser" color="gray.700">
              Design browser
            </ChakraLink>
            <ChakraLink href="#static-bundles" color="gray.700">
              Static bundles
            </ChakraLink>
          </Stack>
        </Box>
      </Box>
    </Grid>
  );
}
