import React from "react"
import { Box, Center, Flex, Text } from "@chakra-ui/react"
import { Link, useLocation, useNavigate } from "@remix-run/react"

import { Commander } from "../Commander/Commander"
import { CommanderV1 } from "../Commander/CommanderV1"
import { Icon } from "../Icon/Icon"
import { RainbowSkeleton } from "../Skeleton/RainbowSkeleton"
import { ProfileDrawer } from "./ProfileDrawer"

export const Footer = (props) => {
  const investmentEmail = "invest@thingtime.com"

  return (
    <Center
      width="100%"
      paddingTop="900px"
      paddingBottom={[5, 12]}
      paddingX={4}
    >
      <Flex width={["500px", "500px"]} maxWidth="100%">
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
            {/* copyright message */}© 2023 Thingtime
          </Flex>
        </Flex>
      </Flex>
    </Center>
  )
}
