import React from 'react';
import { Box, Center, Flex, Text } from '@chakra-ui/react';
import { Link, useLocation, useNavigate } from '@remix-run/react';

import { CommanderV2 } from '../Commander/CommanderV2';
import { Icon } from '../Icon/Icon';
import { MongoStatus } from '../MongoDB/MongoStatus';
import { RainbowSkeleton } from '../Skeleton/RainbowSkeleton';
import { ProfileDrawer } from './ProfileDrawer';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useApi } from '~/hooks/useApi';

let BRANCH_NAME;
try {
  BRANCH_NAME = process.env.THINGTIME_BRANCH_NAME || 'git/unknown';
} catch (e) {
  console.log('Error getting BRANCH_NAME from env:', e);
  // BRANCH_NAME= 'git/unknown';
}

export const Footer = (props) => {
  let clientState: any = {};

  try {
    if (typeof window !== 'undefined') {
      clientState = window.envFromCookie || {};
    }
  } catch (err) {
    // do nothing
  }

  const [branchName, setBranchName] = React.useState(clientState.THINGTIME_BRANCH_NAME || BRANCH_NAME || 'git/unknown');

  const investmentEmail = 'invest@thingtime.com';
  const contactEmail = 'connect@thingtime.com';

  const year = new Date().getFullYear();

  const user = useCurrentUser();
  const api = useApi();
  const navigate = useNavigate();

  const handleLogout = React.useCallback(async () => {
    await api.v1.auth.logout();
    // the fetcher submit revalidates the root loader → user clears
    navigate('/');
  }, [api, navigate]);

  return (
    <Center width="100%" paddingTop="900px" paddingBottom={[5, 12]} paddingX={4}>
      <Flex width={['500px', '500px']} maxWidth="100%" columnGap={[8, 16]}>
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
                  <Text color="green">{investmentEmail}</Text>
                </Flex>
              </Link>
            </Flex>
            <Flex flexDirection="column" fontSize="xs">
              {/* copyright message */}© {year} Thingtime
            </Flex>
          </Flex>
        )}
        <Flex flexDirection="column" rowGap={3}>
          <Flex flexDirection="column">
            <Flex flexDirection="row" fontSize="xs">
              <Icon name="mail" size="12px" chakras={{ pr: 1 }}></Icon>
              Contact
              {/* <Icon name="money bag" size="10px" chakras={{ pl: 1 }}></Icon> */}
            </Flex>
            <Link to={`mailto:${contactEmail}`}>
              <Flex flexDirection="row">
                <Text>{contactEmail}</Text>
              </Flex>
            </Link>
          </Flex>
          <Flex alignItems="center" flexDirection="row" fontSize="xs">
            <Text>
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
                fontSize="10px"
                opacity={0.5}
              >
                🌱 {branchName}
              </Box>
            </Flex>
          )}

          {/* live MongoDB connection status, links to /mongodb-status */}
          <MongoStatus></MongoStatus>

          <Flex flexDirection="row" marginRight="auto">
            <Icon name="rainbow" size="8px"></Icon>
            <Icon name="unicorn" size="8px"></Icon>
            <Icon name="wizard" size="8px"></Icon>
          </Flex>
        </Flex>

        {/* account / user column */}
        <Flex flexDirection="column" rowGap={3}>
          <Flex flexDirection="row" fontSize="xs" alignItems="center">
            <Icon name="unicorn" size="12px" chakras={{ pr: 1 }}></Icon>
            {user ? user.displayName || user.username : 'Account'}
          </Flex>
          {user ? (
            <>
              <Link to="/profile">
                <Text fontSize="xs">Profile</Text>
              </Link>
              <Box as="button" type="button" onClick={handleLogout} textAlign="left">
                <Text fontSize="xs" opacity={0.7}>
                  Log out
                </Text>
              </Box>
              {!user.emailVerified && (
                <Text fontSize="10px" opacity={0.6}>
                  ✉️ email unverified
                </Text>
              )}
            </>
          ) : (
            <>
              <Link to="/login">
                <Text fontSize="xs">Log in</Text>
              </Link>
              <Link to="/register">
                <Text fontSize="xs" opacity={0.7}>
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
