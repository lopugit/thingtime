import React from 'react';
import { Box, Center, Flex, Text } from '@chakra-ui/react';
import { Link, useRouteLoaderData } from '@remix-run/react';

import { Icon } from '../Icon/Icon';
import { MongoStatus } from '../MongoDB/MongoStatus';

const BRANCH_NAME =
  typeof process !== 'undefined' && process.env?.THINGTIME_BRANCH_NAME
    ? process.env.THINGTIME_BRANCH_NAME
    : 'git/unknown';

export const Footer = (props) => {
  const rootData = useRouteLoaderData('root') as any;
  const envFromCookie = rootData?.envFromCookie || {};

  const branchName = envFromCookie.THINGTIME_BRANCH_NAME || BRANCH_NAME || 'git/unknown';

  const investmentEmail = 'invest@thingtime.com';
  const contactEmail = 'connect@thingtime.com';

  const year = new Date().getFullYear();

  return (
    <Center width="100%" paddingTop="900px" paddingBottom={[5, 12]} paddingX={4}>
      <Flex width={['500px', '500px']} maxWidth="100%">
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
      </Flex>
    </Center>
  );
};
