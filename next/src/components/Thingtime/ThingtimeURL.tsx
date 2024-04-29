import React from 'react';
// import { Sticky, StickyContainer } from "react-sticky"
import Sticky from 'react-sticky-el';
import { Box, Flex } from '@chakra-ui/react';
// import { useLocation, useMatches } from '@remix-run/react';

import { useRouter } from 'next/router';

import { Thingtime } from './Thingtime';
import { useThingtime } from './useThingtime';
import { rootPaths } from '~/consts/config';
import Link from 'next/link';

export const ThingtimeURL = (props: any) => {
  console.log('nik props', props);

  const { getThingtime } = useThingtime();

  const router = useRouter();
  const { pathname } = router;

  const navigate = router.push;

  const rawPath = props?.path || router?.query?.path;

  // const { pathname } = useLocation();

  // const matches = useMatches();
  // const location = React.useMemo(() => {
  //   return matches[matches.length - 1];
  // }, [matches]);

  const path = React.useMemo(() => {
    const path = rawPath instanceof Array ? rawPath.join('.') : rawPath;

    // if path starts with any value in rootPaths, remove it
    const adjustedPath = rootPaths.reduce((acc: any, rootPath) => {
      if (typeof path === 'string') {
        if (path.startsWith(rootPath) && acc === null) {
          return path.slice(rootPath.length);
        }
      }
      return acc;
    }, null);

    // remove any leading syntax such as dots or forward slashes
    const sanitisedPath = adjustedPath?.replace(/^[./]+/, '');

    console.log('nik path', path);
    console.log('nik adjustedPath', adjustedPath);
    console.log('nik sanitisedPath', sanitisedPath);

    return sanitisedPath || 'thingtime';
  }, [rawPath]);

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

  const containerRef: any = React.useRef(null);
  const editorRef: any = React.useRef(null);

  React.useEffect(() => {
    const scrollListener = () => {
      if (containerRef?.current?.getBoundingClientRect) {
        const { top } = containerRef?.current?.getBoundingClientRect();

        if (editorRef.current) {
          editorRef.current.style.top = `${-top}px`;
        }
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
      // position="sticky"
      position="relative"
      alignItems={inEditorMode ? 'flex-start' : 'center'}
      justifyContent="center"
      // overflow="scroll"
      // height="auto"
      flexDirection={inEditorMode ? 'row' : 'column'}
      maxWidth="100%"
      // maxHeight="100vh"
    >
      {inEditorMode && (
        <Box
          ref={editorRef}
          position="relative"
          // position="sticky"
          // top={200}
          // alignSelf="flex-start"
          overflow="scroll"
          width="600px"
          // width="100%"
          maxHeight="100vh"
          // paddingY={2}
        >
          <Thingtime
            path={path}
            thing={thing}
            render
            chakras={{ marginY: '200px' }}
            // width="600px"
          ></Thingtime>
        </Box>
      )}
      <Thingtime edit={inEditMode} path={path} thing={thing} chakras={{ marginY: '200px' }} width="600px"></Thingtime>
    </Flex>
  );
};

export async function getServerSideProps(context: any) {
  console.log('nik context?.params?.path', context?.params?.path);

  return {
    props: {
      path: context?.params?.path // Access dynamic route parameters
    }
  };
}
