import React from 'react';
import { Box, Center, Flex, Text } from '@chakra-ui/react';
import { Link, useLocation, useNavigate } from '@remix-run/react';

import { CommanderV2 } from '../Commander/CommanderV2';
import { Icon } from '../Icon/Icon';
import { RainbowSkeleton } from '../Skeleton/RainbowSkeleton';
import { ProfileDrawer } from './ProfileDrawer';
import { useThingtime } from '../Thingtime/useThingtime';
const BRANCH_NAME =
  typeof process !== 'undefined' && process.env?.THINGTIME_BRANCH_NAME
    ? process.env.THINGTIME_BRANCH_NAME
    : 'git/unknown';

console.log('BRANCH_NAME:', BRANCH_NAME);

export const Nav = (props) => {
  let clientState: any = {};

  try {
    if (typeof window !== 'undefined') {
      clientState = window.envFromCookie || {};
    }
  } catch (err) {
    // do nothing
  }

  const [branchName, setBranchName] = React.useState(clientState.THINGTIME_BRANCH_NAME || BRANCH_NAME || 'git/unknown');

  const { thingtime } = useThingtime();

  const [profileDrawerOpen, setProfileDrawerOpen] = React.useState(false);

  const { pathname } = useLocation();

  const navigate = useNavigate();

  const toggleProfileDrawer = React.useCallback(() => {
    setProfileDrawerOpen(!profileDrawerOpen);
  }, [profileDrawerOpen]);

  const inEditorMode = React.useMemo(() => {
    if (pathname.slice(0, 7) === '/editor') {
      return true;
    }

    return false;
  }, [pathname]);

  const inEditMode = React.useMemo(() => {
    if (pathname.slice(0, 5) === '/edit') {
      return true;
    }

    return false;
  }, [pathname]);

  const editorToggleable = React.useMemo(() => {
    if (pathname.slice(0, 7) === '/things') {
      return true;
    } else if (pathname.slice(0, 5) === '/edit') {
      return true;
    }

    if (thingtime.get('thingtimeUrlPageVisible')) {
      return true;
    }

    return false;
  }, [pathname, thingtime]);

  const toggleEdit = React.useCallback(
    (e) => {
      // if first characters of pathname are /things replace with /edit
      // or if first characters of pathname are /edit replace with /things
      if (pathname.slice(0, 7) === '/things') {
        const newPathname = pathname.replace('/things', '/edit');
        navigate(newPathname);
      } else if (pathname.slice(0, 7) === '/editor') {
        const newPathname = pathname.replace('/editor', '/things');
        navigate(newPathname);
      } else if (pathname.slice(0, 5) === '/edit') {
        const newPathname = pathname.replace('/edit', '/things');
        navigate(newPathname);
      } else if (thingtime.get('thingtimeUrlPageVisible')) {
        const newPathname = pathname.replace('/', '/edit/');
        navigate(newPathname);
      }
    },
    [pathname, navigate]
  );

  const toggleEditor = React.useCallback(
    (e) => {
      // if first characters of pathname are /things replace with /edit
      // or if first characters of pathname are /edit replace with /things
      if (pathname.slice(0, 7) === '/editor') {
        const newPathname = pathname.replace('/editor', '/edit');
        navigate(newPathname);
      } else if (pathname.slice(0, 5) === '/edit') {
        const newPathname = pathname.replace('/edit', '/editor');
        navigate(newPathname);
      }
    },
    [pathname, navigate]
  );

  return (
    <>
      <Box position="fixed" zIndex={9999} top={0} right={0} left={0} maxWidth="100vw">
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
          <Center className="nav-left-section" display={['none', 'flex']} height="100%" marginRight="auto">
            <Center transform="scaleX(-100%)" cursor="pointer">
              <Link to="/">
                <Icon size="12px" name="🦄"></Icon>
              </Link>
            </Center>

            {/* Add the current git branch here for dev purposes */}
            {/* Use https://github.com/lopugit/thingtime/tree/ as a link */}
            {/* 14/06/2026 Took this out and moved to footer */}
            {/* <Box
              // link
              as="a"
              href={`https://github.com/lopugit/thingtime/tree/${branchName}`}
              target="_blank"
              marginLeft="8px"
              fontSize="10px"
              opacity={0.5}
            >
              🌱 {branchName}
            </Box> */}
          </Center>
          <CommanderV2 global id="nav" rainbow={false}></CommanderV2>
          <Center className="nav-right-section" columnGap={[3, 8]} height="100%" marginLeft="auto">
            {inEditMode && (
              <Center
                // transform="scaleX(-100%)"
                cursor="pointer"
                onClick={toggleEditor}
              >
                <Icon
                  chakras={{
                    opacity: inEditorMode ? 1 : 0.3
                  }}
                  size="12px"
                  name="👀"
                ></Icon>
                {/* <Icon
                  size="12px"
                  name={inEditorMode ? "glowing star" : "star"}
                ></Icon> */}
              </Center>
            )}
            {editorToggleable && (
              <Center transform="scaleX(-100%)" cursor="pointer" onClick={toggleEdit}>
                <Icon
                  chakras={{
                    opacity: inEditMode ? 1 : 0.3
                  }}
                  size="12px"
                  name="🎨"
                ></Icon>
                {/* <Icon
                  size="12px"
                  name={inEditMode ? "glowing star" : "star"}
                ></Icon> */}
              </Center>
            )}
            {/* TODO - Add conditional only show if loggedIn */}
            {/* <Center transform={['', 'scaleX(-100%)']} cursor="pointer">
              <Link to="/logout">
                <Icon size="12px" name="🗝️"></Icon>
              </Link>
            </Center> */}
            <Center cursor="pointer">
              <Link to="/login">
                <Flex flexDir={'row'} gap={2}>
                  <Box fontSize="xs" opacity={0.5}>
                    Login
                  </Box>
                  <Icon transform={['', 'scaleX(-100%)']} size="12px" name="🌈"></Icon>
                </Flex>
              </Link>
            </Center>
            <Center display={['flex', 'none']} cursor="pointer">
              <Link to="/">
                <Icon size="12px" name="🦄"></Icon>
              </Link>
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
  );
};
