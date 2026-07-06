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
      <Flex
        minHeight="100vh"
        width="100%"
        align="center"
        justify="center"
        direction="column"
        gap={4}
        background="var(--tt-surface, #fafafb)"
      >
        <Text color="var(--tt-text, #5a5a66)">You're not logged in.</Text>
        <Link to="/login">
          <Text color="var(--tt-link, #2f8fd6)" fontWeight="600">
            Log in →
          </Text>
        </Link>
      </Flex>
    );
  }

  return (
    <Flex
      minHeight="100vh"
      width="100%"
      align="center"
      justify="center"
      direction="column"
      px={4}
      background="var(--tt-surface, #fafafb)"
    >
      <UserCard user={user}>
        <Button
          mt={2}
          onClick={handleLogout}
          color="white"
          fontFamily="heading"
          fontWeight="600"
          background={RAINBOW}
          backgroundSize="calc(100px + 200%)"
          sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
          _hover={{ opacity: 0.9 }}
          borderRadius="var(--tt-radius-md, 12px)"
        >
          Log out 🗝️
        </Button>

        {!user.emailVerified && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleResend}
            color="var(--tt-rainbow-5, #a555e8)"
            borderColor="var(--tt-border, #ececef)"
            _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
            borderRadius="var(--tt-radius-md, 12px)"
          >
            Resend verification email 📬
          </Button>
        )}
      </UserCard>
    </Flex>
  );
}
