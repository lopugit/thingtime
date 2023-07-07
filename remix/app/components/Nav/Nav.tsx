import React from "react"
import { Box, Flex } from "@chakra-ui/react"

import { Commander } from "../Commander/Commander"
import { RainbowSkeleton } from "../Skeleton/RainbowSkeleton"
import { ProfileDrawer } from "./ProfileDrawer"

export const Nav = (props) => {
  const [profileDrawerOpen, setProfileDrawerOpen] = React.useState(false)

  const toggleProfileDrawer = React.useCallback(() => {
    setProfileDrawerOpen(!profileDrawerOpen)
  }, [profileDrawerOpen])

  return (
    <>
      <Box
        position="fixed"
        zIndex={999}
        top={0}
        right={0}
        left={0}
        maxWidth="100vw"
      >
        <Flex
          as="nav"
          position="relative"
          alignItems="center"
          justifyContent="center"
          flexDirection="row"
          width="100%"
          maxWidth="100%"
          marginY={1}
          paddingX="12px"
          paddingY="10px"
          // bg='white'
          // boxShadow={'0px 0px 10px rgba(0,0,0,0.1)'}
        >
          <Commander></Commander>
          <RainbowSkeleton
            marginLeft="auto"
            width="25px"
            height="25px"
            cursor="pointer"
            onClick={toggleProfileDrawer}
            background="rgba(0,0,0,0.1)"
            sx={{}}
            borderRadius="999px"
          ></RainbowSkeleton>
          {/* <RainbowSkeleton w='40px' ml='auto' mr={"4px"}></RainbowSkeleton>
          <RainbowSkeleton></RainbowSkeleton> */}
        </Flex>
      </Box>
      {/* <ProfileDrawer isOpen={profileDrawerOpen}></ProfileDrawer> */}
    </>
  )
}
