import React from 'react';
// import { Sticky, StickyContainer } from "react-sticky"
import Sticky from 'react-sticky-el';
import { Box, Flex } from '@chakra-ui/react';
import { useLocation, useMatches } from '@remix-run/react';

import { Thingtime } from './Thingtime';
import { useThingtime } from './useThingtime';
import { ThingtimeTypes } from '~/Providers/ThingtimeProvider';
import { v4 as uuidv4 } from 'uuid';

export const ThingtimeURL = (props) => {
  const [uuid, setUuid] = React.useState(uuidv4());
  const { getThingtime } = useThingtime('ThingtimeURL-' + uuid + '-');
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

    return path || 'thingtime';
  }, [location]);

  const thing = React.useMemo(() => {
    console.log('[tt][ThingtimeURL.tsx/thing] getting new thing from path', path);
    // remove /things/ from path

    const ret = getThingtime(path);

    console.log('[tt][ThingtimeURL.tsx/thing] got thing at path', path, 'value: ', ret);

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
      try {
        if (containerRef?.current?.getBoundingClientRect) {
          const { top } = containerRef?.current?.getBoundingClientRect();

          editorRef.current.style.top = `${-top}px`;
        }
      } catch (error) {
        // silently catch errors
        // console.error('Error in scrollListener:', error);
      }
    };

    window.addEventListener('scroll', scrollListener);
    // also run on window resize in case of changes to layout
    window.addEventListener('resize', scrollListener);

    // call scrollListener once to set initial position
    scrollListener();

    return () => {
      window.removeEventListener('scroll', scrollListener);
      window.removeEventListener('resize', scrollListener);
    };
  }, []);

  console.log('[tt][ThingtimeURL.tsx/return', {
    inEditorMode,
    inEditMode,
    path,
    thing
  });

  return (
    <Flex
      ref={containerRef}
      position="relative"
      // alignItems={inEditorMode ? 'flex-start' : 'center'}
      className="thingtimeUrlFlexRoot"
      alignItems={'flex-start'}
      justifyContent="center"
      flexDirection={inEditorMode ? 'row' : 'column'}
      width="100%"
      maxWidth="100%"
    >
      {inEditorMode && (
        <Box className="inEditorModeBox" ref={editorRef} position="relative" overflow="scroll" width="container" maxHeight="100vh">
          <Thingtime
            className="inEditorModeThingtime"
            chakras={{
              // breakpoint supported general margins
              // breakpoints for margin: base: '50px', sm: '100px', md: '150px', lg: '200px', xl: '250px', '2xl': '300px'
              // just use small values like 12 and up to 24 for max size
              margin: {
                base: '12px',
                sm: '16px',
                md: '20px',
                lg: '24px',
                xl: '24px',
                '2xl': '24px'
              },
              marginY: {
                // apply to all breakpoints
                base: '200px',
                sm: '200px',
                md: '200px',
                lg: '200px',
                xl: '200px',
                '2xl': '200px'
              }
            }}
            render
            debugId="ThingtimeURLEditor"
          >
            <Thingtime path={path} thing={thing} render></Thingtime>
          </Thingtime>
        </Box>
      )}
      <Thingtime
        className="inEditModeThingtime"
        edit={inEditMode}
        path={path}
        thing={thing}
        chakras={{ marginY: '200px' }}
        width={inEditorMode ? '100%' : '100%'}
        overflowX="scroll"
      ></Thingtime>
    </Flex>
  );
};
