import { Flex, Text, Button } from '@chakra-ui/react';
import { Link, useNavigate } from '@remix-run/react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { UserCard, RAINBOW } from '~/components/User/UserCard';

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
      <UserCard user={user}>
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
      </UserCard>
    </Flex>
  );
}
