import React from 'react';
import { Flex } from '@chakra-ui/react';
import { useLocation, useMatches } from 'react-router';

import { EditorSplit } from './EditorSplit';
import { Thingtime } from './Thingtime';
import { parseThingMode, parseThingPath } from './thingRoute';
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
    // mode prefixes ('/things', '/edit', '/editor') are stripped by the shared
    // parser, so '/edit' shows the root thing in edit mode rather than a thing
    // literally named 'edit'
    return parseThingPath(location?.pathname || pathname);
  }, [location, pathname]);

  const thing = React.useMemo(() => {
    return getThingtime(path);
  }, [path, getThingtime]);

  const mode = React.useMemo(() => {
    return parseThingMode(pathname);
  }, [pathname]);

  const inEditorMode = mode === 'editor';

  const inEditMode = mode === 'edit';

  // editor mode: sub-splittable multi-window workspace, each window with its
  // own path, mode, and scroll context
  if (inEditorMode) {
    return (
      <Flex
        className="thingtimeUrlFlexRoot"
        alignItems="flex-start"
        justifyContent="center"
        width="100%"
        maxWidth="100%"
        paddingX={{ base: '10px', md: '18px' }}
        // clear the fixed nav so window toolbars stay visible
        paddingTop={{ base: '64px', md: '70px' }}
        paddingBottom="14px"
      >
        <EditorSplit initialPath={path} />
      </Flex>
    );
  }

  return (
    <Flex
      position="relative"
      className="thingtimeUrlFlexRoot"
      alignItems={'flex-start'}
      justifyContent="center"
      flexDirection={'column'}
      width="100%"
      maxWidth="100%"
    >
      <Thingtime
        className="inEditModeThingtime"
        edit={inEditMode}
        path={path}
        thing={thing}
        chakras={{ marginY: '200px' }}
        width="100%"
      ></Thingtime>
    </Flex>
  );
};
