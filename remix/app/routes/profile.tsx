import { Flex, Text, Button } from '@chakra-ui/react';
import { Link, useNavigate } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { UserCard, RAINBOW } from '~/components/User/UserCard';

export default function Profile() {
  const user = useCurrentUser();
  const api = useApi();
  const navigate = useNavigate();
  const lopu = useLopu();

  const handleLogout = async () => {
    await api.v1.auth.logout();
    navigate('/login');
  };

  const handleResend = async () => {
    if (!user) return;
    const resp = await api.v1.auth.resendVerification({ email: user.email });
    lopu({
      title: 'Verification email sent 📬',
      description: 'Check your inbox to verify your account.',
      status: 'success',
      link: resp?.verificationLink ? { label: '🔗 Verify now (dev)', href: resp.verificationLink } : undefined
    });
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

        {!user.emailVerified && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleResend}
            color="purple.500"
            borderColor="purple.200"
            _hover={{ bg: 'purple.50' }}
            borderRadius={10}
          >
            Resend verification email 📬
          </Button>
        )}
      </UserCard>
    </Flex>
  );
}
