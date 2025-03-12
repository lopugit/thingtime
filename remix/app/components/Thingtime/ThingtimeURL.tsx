import React from 'react';
// import { Sticky, StickyContainer } from "react-sticky"
import Sticky from 'react-sticky-el';
import { Box, Flex } from '@chakra-ui/react';
import { useLocation, useMatches } from '@remix-run/react';

import { Thingtime } from './Thingtime';
import { useThingtime } from './useThingtime';

export const ThingtimeURL = (props) => {
  const { getThingtime } = useThingtime();

  const { pathname } = useLocation();

  const matches = useMatches();
  const location = React.useMemo(() => {
    return matches[matches.length - 1];
  }, [matches]);

  const path = React.useMemo(() => {
    console.log('ThingtimeURL location', location);

    // const sanitisation = ["/things", "/edit", "/editor", "/code", "/coder"]

    // // strip the leading /path1/path2 path1 section from the path
    // let pathPartOne = location?.pathname?.split("/")[2]

    // // remove all sanitsation strings from path
    // sanitisation.forEach((sanitisationString) => {
    //   pathPartOne = pathPartOne?.replace(sanitisationString, "")
    // })

    // strip the leading /path1/path2 path1 section from the path
    const pathPartOne = location?.pathname?.split('/')[2];

    // if pathPartOne is undefined, split and use [1]
    const pathPartTwo = location?.pathname?.split('/')[1];

    // TODO: maybe do this path part one / two thing a bit cleaner??

    const path = pathPartOne?.replace(/\//g, '.') || pathPartTwo?.replace(/\//g, '.');

    console.log('nik path', path);

    return path || 'thingtime';
  }, [location]);

  const thing = React.useMemo(() => {
    // remove /things/ from path

    const ret = getThingtime(path);

    return ret;
  }, [path, getThingtime]);

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

  const containerRef = React.useRef(null);
  const editorRef = React.useRef(null);

  React.useEffect(() => {
    const scrollListener = () => {
      if (containerRef?.current?.getBoundingClientRect) {
        const { top } = containerRef?.current?.getBoundingClientRect();

        editorRef.current.style.top = `${-top}px`;
      }
    };

    window.addEventListener('scroll', scrollListener);

    return () => {
      window.removeEventListener('scroll', scrollListener);
    };
  }, []);

  return (
    <Flex
      ref={containerRef}
      position="relative"
      alignItems={inEditorMode ? 'flex-start' : 'center'}
      justifyContent="center"
      flexDirection={inEditorMode ? 'row' : 'column'}
      maxWidth="100%"
    >
      {inEditorMode && (
        <Box ref={editorRef} position="relative" overflow="scroll" width="container" maxHeight="100vh">
          <Thingtime path={path} thing={thing} render chakras={{ marginY: '200px' }}></Thingtime>
        </Box>
      )}
      <Thingtime edit={inEditMode} path={path} thing={thing} chakras={{ marginY: '200px' }} width="600px"></Thingtime>
    </Flex>
  );
};
