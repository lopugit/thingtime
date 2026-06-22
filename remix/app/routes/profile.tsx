import { Flex, Box, Text, Button } from '@chakra-ui/react';
import { Link, useNavigate } from '@remix-run/react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';

const RAINBOW = 'linear-gradient(120deg, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6)';

export default function Profile() {
  const user = useCurrentUser();
  const api = useApi();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await api.v1.auth.logout();
    navigate('/');
  };

  if (!user) {
    return (
      <Flex minHeight="100vh" width="100%" align="center" justify="center" direction="column" gap={4}>
        <Text>You're not logged in.</Text>
        <Link to="/login">
          <Text color="blue.400">Log in →</Text>
        </Link>
      </Flex>
    );
  }

  return (
    <Flex minHeight="100vh" width="100%" align="center" justify="center" direction="column" px={4}>
      <Box p="2px" borderRadius="22px" backgroundImage={RAINBOW} maxWidth="360px" width="100%" boxShadow="0 10px 34px rgba(0,0,0,0.12)">
        <Flex bg="white" borderRadius="20px" p={6} direction="column" gap={3}>
          <Text fontSize="2xl" fontWeight="700">
            🦄 {user.displayName || user.username}
          </Text>
          <Text fontSize="sm" color="gray.500">
            @{user.username}
          </Text>
          <Text fontSize="sm">
            {user.email} {user.emailVerified ? '✅ verified' : '✉️ unverified'}
          </Text>

          <Button
            mt={2}
            onClick={handleLogout}
            color="white"
            fontWeight="bold"
            backgroundImage={RAINBOW}
            backgroundSize="calc(100px + 400%)"
            _hover={{ opacity: 0.9 }}
            borderRadius={10}
          >
            Log out 🗝️
          </Button>
        </Flex>
      </Box>
    </Flex>
  );
}
