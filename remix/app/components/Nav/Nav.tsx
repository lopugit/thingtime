import React from "react"
import { Box, Center, Flex } from "@chakra-ui/react"
import { Link, useLocation, useNavigate } from "@remix-run/react"

import { Commander } from "../Commander/Commander"
import { CommanderV1 } from "../Commander/CommanderV1"
import { Icon } from "../Icon/Icon"
import { RainbowSkeleton } from "../Skeleton/RainbowSkeleton"
import { ProfileDrawer } from "./ProfileDrawer"

export const Nav = (props) => {
  const [profileDrawerOpen, setProfileDrawerOpen] = React.useState(false)

  const { pathname } = useLocation()

  const navigate = useNavigate()

  const toggleProfileDrawer = React.useCallback(() => {
    setProfileDrawerOpen(!profileDrawerOpen)
  }, [profileDrawerOpen])

  const inEditMode = React.useMemo(() => {
    if (pathname.slice(0, 5) === "/edit") {
      return true
    }
    return false
  }, [pathname])

  const editorToggleable = React.useMemo(() => {
    if (pathname.slice(0, 7) === "/things") {
      return true
    } else if (pathname.slice(0, 5) === "/edit") {
      return true
    }
    return false
  }, [pathname])

  const toggleEditor = React.useCallback(
    (e) => {
      // if first characters of pathname are /things replace with /edit
      // or if first characters of pathname are /edit replace with /things
      if (pathname.slice(0, 7) === "/things") {
        const newPathname = pathname.replace("/things", "/edit")
        navigate(newPathname)
      } else if (pathname.slice(0, 5) === "/edit") {
        const newPathname = pathname.replace("/edit", "/things")
        navigate(newPathname)
      }
    },
    [pathname, navigate]
  )

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
          paddingX="18px"
          paddingY="14px"
          // bg='white'
          // boxShadow={'0px 0px 10px rgba(0,0,0,0.1)'}
        >
          <Center className="nav-left-section" height="100%" marginRight="auto">
            <Center transform="scaleX(-100%)" cursor="pointer">
              <Link to="/">
                <Icon size="12px" name="unicorn"></Icon>
              </Link>
            </Center>
          </Center>
          <CommanderV1 global id="nav" rainbow></CommanderV1>
          <Center
            className="nav-right-section"
            columnGap={[3, 5]}
            height="100%"
            marginLeft="auto"
          >
            {editorToggleable && (
              <Center
                transform="scaleX(-100%)"
                cursor="pointer"
                onClick={toggleEditor}
              >
                <Icon
                  chakras={{
                    opacity: inEditMode ? 1 : 0.3,
                  }}
                  size="12px"
                  name="paint"
                ></Icon>
                {/* <Icon
                  size="12px"
                  name={inEditMode ? "glowing star" : "star"}
                ></Icon> */}
              </Center>
            )}
            <Center transform="scaleX(-100%)" cursor="pointer">
              <Icon size="12px" name="rainbow"></Icon>
            </Center>
          </Center>
          {/* <RainbowSkeleton
            marginLeft="auto"
            width="25px"
            height="25px"
            cursor="pointer"
            onClick={toggleProfileDrawer}
            background="rgba(0,0,0,0.1)"
            sx={{}}
            borderRadius="999px"
          ></RainbowSkeleton> */}
          {/* <RainbowSkeleton w='40px' ml='auto' mr={"4px"}></RainbowSkeleton>
          <RainbowSkeleton></RainbowSkeleton> */}
        </Flex>
      </Box>
      {/* <ProfileDrawer isOpen={profileDrawerOpen}></ProfileDrawer> */}
    </>
  )
}
