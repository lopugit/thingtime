import React from 'react';
import { Box, Center, Flex, Text } from '@chakra-ui/react';
// import Link from 'next/link';
import Link from 'next/link';
import { Commander } from '../Commander/Commander';
import { CommanderV1 } from '../Commander/CommanderV2';
import { Icon } from '../Icon/Icon';
import { RainbowSkeleton } from '../Skeleton/RainbowSkeleton';
import { ProfileDrawer } from './ProfileDrawer';

export const Footer = (props: any) => {
  const investmentEmail = 'invest@thingtime.com';
  const contactEmail = 'connect@thingtime.com';

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
              <Link href={`mailto:${investmentEmail}`}>
                <Flex flexDirection="row">
                  <Text color="green">{investmentEmail}</Text>
                </Flex>
              </Link>
            </Flex>
            <Flex flexDirection="column" fontSize="xs">
              {/* copyright message */}© 2023 Thingtime
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
            <Link href={`mailto:${contactEmail}`}>
              <Flex flexDirection="row">
                <Text>{contactEmail}</Text>
              </Flex>
            </Link>
          </Flex>
          <Flex alignItems="center" flexDirection="row" fontSize="xs">
            <Text>{/* copyright message */}© 2023 Thingtime</Text>
          </Flex>
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
