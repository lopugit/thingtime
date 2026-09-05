import React from 'react';
import { Box, Center, Flex, Text } from '@chakra-ui/react';
import { Link, useNavigate, useRouteLoaderData } from 'react-router';

import { Icon } from '../Icon/Icon';
import { FooterStatusPanel } from '../Status/FooterStatusPanel';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '../Lopu/useLopu';
import { burstAtEvent } from '../Landing/confetti';
import { motionOK, pickIncantation } from '~/eggs/eggs';
import { LOGIN_TO_CLAIM_LABEL, getUserDisplayName, getUserMention } from '~/utils/userIdentity';

const BRANCH_NAME =
  typeof process !== 'undefined' && process.env?.THINGTIME_BRANCH_NAME
    ? process.env.THINGTIME_BRANCH_NAME
    : 'git/unknown';

const COMMIT_SHA =
  typeof process !== 'undefined'
    ? process.env?.VERCEL_GIT_COMMIT_SHA || process.env?.THINGTIME_GIT_COMMIT_SHA
    : undefined;

export const Footer = (props) => {
  const rootData = useRouteLoaderData('root') as any;
  const envFromCookie = rootData?.envFromCookie || {};

  const branchName = envFromCookie.THINGTIME_BRANCH_NAME || BRANCH_NAME || 'git/unknown';
  const commitSha = envFromCookie.THINGTIME_VERCEL_GIT_COMMIT_SHA || COMMIT_SHA;
  const showDeploymentStatus = envFromCookie.THINGTIME_SHOW_DEPLOYMENT_STATUS === 'true';

  const investmentEmail = 'invest@thingtime.com';
  const contactEmail = 'connect@thingtime.com';

  const year = new Date().getFullYear();

  const user = useCurrentUser();
  const api = useApi();
  const navigate = useNavigate();
  const lopu = useLopu();

  // 🥚 Easter egg: the decorative footer wizard actually casts spells.
  const castSpell = React.useCallback(
    (e: React.MouseEvent) => {
      if (motionOK()) burstAtEvent(e as any, 40);
      lopu({ title: pickIncantation(), description: '🧙 The footer wizard waves a tiny wand.', status: 'info' });
    },
    [lopu]
  );

  const handleLogout = React.useCallback(async () => {
    const resp = await api.v1.auth.logout();
    // Switcher semantics: with other accounts signed in the next one takes
    // over — stay put and let the root revalidation swap the user.
    if (resp?.user) {
      lopu({ title: `Logged out — switched to ${getUserMention(resp.user)} ✨`, status: 'success', duration: 6000 });
      return;
    }
    // the fetcher submit revalidates the root loader → user clears
    navigate('/login');
  }, [api, navigate, lopu]);

  return (
    <Center
      className="thingtimeFooter"
      width="100%"
      // Keep a deliberate visual break after page content without creating
      // a route-wide dead-scroll area before the shared footer.
      paddingTop={['48px', '64px']}
      paddingBottom={[
        'calc(128px + var(--thingtime-safe-area-bottom))',
        'calc(72px + var(--thingtime-safe-area-bottom))'
      ]}
      paddingX={4}
      color="var(--tt-text, #5a5a66)"
    >
      <Flex
        alignItems="flex-start"
        columnGap={[8, 12]}
        flexWrap="wrap"
        maxWidth="100%"
        rowGap={8}
        width={['100%', '760px']}
      >
        {false && (
          <Flex flexDirection="column" rowGap={3}>
            <Flex flexDirection="column">
              <Flex flexDirection="row" fontSize="xs">
                <Icon name="cash" size="12px" chakras={{ pr: 1 }}></Icon>
                To invest, please contact:
                {/* <Icon name="money bag" size="10px" chakras={{ pl: 1 }}></Icon> */}
              </Flex>
              <Link to={`mailto:${investmentEmail}`}>
                <Flex flexDirection="row">
                  <Text color="var(--tt-positive, #2f8f4f)">{investmentEmail}</Text>
                </Flex>
              </Link>
            </Flex>
            <Flex flexDirection="column" fontSize="xs">
              {/* copyright message */}© {year} Thingtime
            </Flex>
          </Flex>
        )}
        <Flex flex="1 1 160px" flexDirection="column" minWidth="140px" rowGap={3}>
          <Flex flexDirection="column">
            <Flex
              alignItems="center"
              flexDirection="row"
              fontFamily="mono"
              fontSize="10px"
              fontWeight={600}
              letterSpacing="0.1em"
              textTransform="uppercase"
              color="var(--tt-muted, #9a9aa6)"
            >
              <Icon name="mail" size="12px" chakras={{ pr: 1 }}></Icon>
              Contact
              {/* <Icon name="money bag" size="10px" chakras={{ pl: 1 }}></Icon> */}
            </Flex>
            <Link to={`mailto:${contactEmail}`}>
              <Flex flexDirection="row">
                <Text fontSize="xs" color="var(--tt-text, #5a5a66)">
                  {contactEmail}
                </Text>
              </Flex>
            </Link>
          </Flex>
          <Flex alignItems="center" flexDirection="row" fontSize="xs">
            <Text color="var(--tt-muted, #9a9aa6)">
              {/* copyright message */}© {year} Thingtime
            </Text>
          </Flex>
          {/* Render the exact source identity for this build. */}
          {branchName && (
            <Flex flexDirection="row" fontSize="xs">
              <Box
                as="a"
                href={`https://github.com/lopugit/thingtime/tree/${branchName}`}
                target="_blank"
                rel="noreferrer"
                fontFamily="mono"
                fontSize="10px"
                color="var(--tt-faint, #b6b6c0)"
              >
                🌱 {branchName}
              </Box>
            </Flex>
          )}
          {commitSha && (
            <Flex flexDirection="row" fontSize="xs" minWidth={0}>
              <Box
                as="a"
                href={`https://github.com/lopugit/thingtime/commit/${commitSha}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Exact git commit ${commitSha}`}
                title={`Exact git commit ${commitSha}`}
                fontFamily="mono"
                fontSize="10px"
                lineHeight="1.4"
                wordBreak="break-all"
                color="var(--tt-faint, #b6b6c0)"
              >
                🔖 {commitSha}
              </Box>
            </Flex>
          )}

          <FooterStatusPanel
            envFromCookie={envFromCookie}
            showDeploymentStatus={showDeploymentStatus}
          />

          <Flex flexDirection="row" marginRight="auto">
            <Icon name="rainbow" size="8px"></Icon>
            <Icon name="unicorn" size="8px"></Icon>
            <Icon
              name="wizard"
              size="8px"
              cursor="pointer"
              title="✨"
              aria-label="Cast a spell"
              onClick={castSpell}
            ></Icon>
          </Flex>
        </Flex>

        {/* docs column */}
        <Flex flex="1 1 140px" flexDirection="column" minWidth="130px" rowGap={3}>
          <Flex
            alignItems="center"
            flexDirection="row"
            fontFamily="mono"
            fontSize="10px"
            fontWeight={600}
            letterSpacing="0.1em"
            textTransform="uppercase"
            color="var(--tt-muted, #9a9aa6)"
          >
            <Icon name="book-open" size="12px" chakras={{ pr: 1 }}></Icon>
            Docs
          </Flex>
          <Link to="/docs/">
            <Text fontSize="xs" color="var(--tt-text, #5a5a66)">
              Docs home
            </Text>
          </Link>
          <Link to="/docs/design">
            <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
              Design mockups
            </Text>
          </Link>
          <Link to="/docs/design-system">
            <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
              Design system
            </Text>
          </Link>
        </Flex>

        {/* account / user column */}
        <Flex flex="1 1 140px" flexDirection="column" minWidth="130px" rowGap={3}>
          <Flex
            alignItems="center"
            flexDirection="row"
            fontFamily="mono"
            fontSize="10px"
            fontWeight={600}
            letterSpacing="0.1em"
            textTransform="uppercase"
            color="var(--tt-muted, #9a9aa6)"
          >
            <Icon name="rainbow" size="12px" chakras={{ pr: 1 }}></Icon>
            {user ? getUserDisplayName(user) : 'Account'}
          </Flex>
          {user?.temporary ? (
            <>
              <Link to="/login">
                <Text fontSize="xs" color="var(--tt-text, #5a5a66)">
                  {LOGIN_TO_CLAIM_LABEL}
                </Text>
              </Link>
              <Link to="/register">
                <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
                  Create account
                </Text>
              </Link>
            </>
          ) : user ? (
            <>
              <Link to="/profile">
                <Text fontSize="xs" color="var(--tt-text, #5a5a66)">
                  Profile
                </Text>
              </Link>
              <Box as="button" type="button" onClick={handleLogout} textAlign="left">
                <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
                  Log out
                </Text>
              </Box>
              {!user.emailVerified && !user.temporary && (
                <Text fontSize="10px" color="var(--tt-muted, #9a9aa6)">
                  ✉️ email unverified
                </Text>
              )}
            </>
          ) : (
            <>
              <Link to="/login">
                <Text fontSize="xs" color="var(--tt-text, #5a5a66)">
                  Log in
                </Text>
              </Link>
              <Link to="/register">
                <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
                  Register
                </Text>
              </Link>
            </>
          )}
        </Flex>
      </Flex>
    </Center>
  );
};
