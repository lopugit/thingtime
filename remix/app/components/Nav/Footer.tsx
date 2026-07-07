import React from 'react';
import { Box, Center, Flex, Text } from '@chakra-ui/react';
import { Link, useNavigate, useRouteLoaderData } from 'react-router';

import { Icon } from '../Icon/Icon';
import { FooterStatusPanel } from '../Status/FooterStatusPanel';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';

const BRANCH_NAME =
  typeof process !== 'undefined' && process.env?.THINGTIME_BRANCH_NAME
    ? process.env.THINGTIME_BRANCH_NAME
    : 'git/unknown';

export const Footer = (props) => {
  const rootData = useRouteLoaderData('root') as any;
  const envFromCookie = rootData?.envFromCookie || {};

  const branchName = envFromCookie.THINGTIME_BRANCH_NAME || BRANCH_NAME || 'git/unknown';
  const showDeploymentStatus = envFromCookie.THINGTIME_SHOW_DEPLOYMENT_STATUS === 'true';

  const investmentEmail = 'invest@thingtime.com';
  const contactEmail = 'connect@thingtime.com';

  const year = new Date().getFullYear();

  const user = useCurrentUser();
  const api = useApi();
  const navigate = useNavigate();

  const handleLogout = React.useCallback(async () => {
    await api.v1.auth.logout();
    // the fetcher submit revalidates the root loader → user clears
    navigate('/login');
  }, [api, navigate]);

  return (
    <Center
      className="thingtimeFooter"
      width="100%"
      paddingTop="900px"
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
          {/* using window.env.BRANCH_NAME render the current branch name */}
          {branchName && (
            <Flex flexDirection="row" fontSize="xs">
              <Box
                // link
                as="a"
                href={`https://github.com/lopugit/thingtime/tree/${branchName}`}
                target="_blank"
                fontFamily="mono"
                fontSize="10px"
                color="var(--tt-faint, #b6b6c0)"
              >
                🌱 {branchName}
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
            <Icon name="wizard" size="8px"></Icon>
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
            {user ? user.displayName || user.username : 'Account'}
          </Flex>
          {user ? (
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
              {!user.emailVerified && (
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
