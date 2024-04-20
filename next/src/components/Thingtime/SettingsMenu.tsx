import React, { useState } from 'react';
import ClickAwayListener from 'react-click-away-listener';
import { Center, Flex, Text } from '@chakra-ui/react';

import { Icon } from '../Icon/Icon';
import { useThingtime } from './useThingtime';

export const SettingsMenu = (props: any) => {
  const [show, setShow] = useState(false);
  const hideRef = React.useRef(null);
  const [opacity, setOpacity] = React.useState(props?.opacity === 0 ? 0 : 1);
  const [pinStatus, setPinStatus] = React.useState(false);

  const stateRef = React.useRef({
    pinStatus
  });

  React.useEffect(() => {
    stateRef.current.pinStatus = pinStatus;
  }, [pinStatus]);

  const { thingtime, events } = useThingtime();

  const opacityRef = React.useRef(null);

  const waitTime = 1555;

  const [uuid, setUuid] = React.useState(null);

  React.useEffect(() => {
    setUuid(Math.random().toString(36).substring(7));
  }, []);

  React.useEffect(() => {
    const subscription = events.subscribe((event) => {
      if (event?.type === 'settings-menu-hide' && event?.uuid !== uuid) {
        if (!stateRef?.current?.pinStatus || event?.force) {
          setShow(false);
          setOpacity(0);
        }
      }
    });

    return () => {
      subscription?.unsubscribe?.();
    };
  }, [events, uuid]);

  React.useEffect(() => {
    clearInterval(opacityRef?.current);
    if (props?.opacity) {
      setOpacity(props?.opacity);
    } else {
      opacityRef.current = setInterval(() => {
        if (!stateRef?.current?.pinStatus) {
          setOpacity(props?.opacity);
          setShow(false);
        }
      }, waitTime);
    }
  }, [props?.opacity]);

  React.useEffect(() => {
    if (show || props?.opacity) {
      clearInterval(hideRef?.current);
      events.next({
        type: 'settings-menu-hide',
        uuid
      });
    } else if (!show) {
      setPinStatus(false);
    }
  }, [show, props?.opacity, events, uuid]);

  const maybeHide = React.useCallback(() => {
    clearInterval(hideRef?.current);
    hideRef.current = setTimeout(() => {
      if (!stateRef?.current?.pinStatus) {
        setShow(false);
        setOpacity(0);
      }
    }, waitTime);
  }, []);

  const showMenu = React.useCallback(() => {
    clearInterval(hideRef?.current);
    setShow(true);
  }, []);

  const hideMenu = React.useCallback(() => {
    setShow(false);
  }, []);

  const basePadding = React.useMemo(() => {
    return 4;
  }, []);

  const types = React.useMemo(() => {
    const baseTypes = thingtime?.settings?.types?.javascript || {};
    const baseTypeKeys = Object.keys(baseTypes);

    const customTypes = thingtime?.settings?.types?.custom || {};
    const customTypeKeysRaw = Object.keys(customTypes);
    const customTypeKeys = customTypeKeysRaw?.filter((key) => {
      return !baseTypeKeys?.includes?.(key);
    });

    const types = [
      ...(baseTypeKeys?.map?.((key) => {
        return {
          ...baseTypes?.[key],
          key
        };
      }) || []),
      ...(customTypeKeys?.map?.((key) => {
        return {
          ...customTypes?.[key],
          key
        };
      }) || [])
    ];

    return types;
  }, [thingtime?.settings?.types?.javascript, thingtime?.settings?.types?.custom]);

  const onType = React.useCallback(
    (args) => {
      props?.onType?.(args);
    },
    [props?.onType]
  );
  const onDelete = React.useCallback(
    (type) => {
      props?.onDelete?.();
    },
    [props?.onDelete]
  );

  const childIconSize = 10;
  const iconSize = props?.iconSize || 7;

  return (
    <ClickAwayListener onClickAway={hideMenu}>
      <Center
        position="relative"
        // width="100%"
        paddingRight={36}
        opacity={opacity}
        transition={props?.transition || 'all 0.2s ease-in-out'}
        onMouseEnter={showMenu}
        onMouseLeave={maybeHide}
      >
        <Flex
          paddingLeft={1}
          // opacity={showContextIcon ? 1 : 0}
          cursor="pointer"
          // onClick={deleteValue}
          transition="all 0.2s ease-in-out"
        >
          <Icon name="wizard" size={iconSize}></Icon>
        </Flex>
        <Flex
          position="absolute"
          zIndex={999}
          top="100%"
          left={0}
          flexDirection="column"
          opacity={show ? 1 : 0}
          pointerEvents={show ? 'all' : 'none'}
        >
          <Flex position="absolute" top={0} right={0} padding="5px" cursor="pointer" onClick={() => setPinStatus((prev) => !prev)}>
            <Icon opacity={pinStatus ? 1 : 0.5} name={pinStatus ? 'pinned' : 'pin'} size="8px"></Icon>
          </Flex>
          <Flex
            flexDirection="column"
            // rowGap={basePadding / 3}
            background="greys.lightt"
            borderRadius={4}
            boxShadow={props?.boxShadow || '0px 2px 7px 0px rgba(0,0,0,0.2)'}
            paddingY={basePadding}
          >
            {!props?.readonly && (
              <Flex
                alignItems="center"
                flexDirection="row"
                // paddingRight={basePadding}
                paddingLeft={basePadding}
                _hover={{
                  background: 'greys.light'
                }}
                cursor="pointer"
                // paddingX={basePadding * 1}
                paddingY={basePadding / 2}
              >
                <Icon marginBottom="-2px" name="cyclone" size={childIconSize}></Icon>
                <Text marginTop="-2px" paddingLeft={2} fontSize="xs">
                  Types
                </Text>
              </Flex>
            )}
            <Flex
              flexDirection="column"
              // rowGap={basePadding}
              overflowY="scroll"
              maxHeight="300px"
              background="greys.lightt"
              cursor="pointer"
            >
              {!props?.readonly &&
                types.map((type, idx) => {
                  const ret = (
                    <Flex
                      key={props?.uuid + props?.fullPath + '-type-menu-' + idx}
                      width="100%"
                      _hover={{
                        '&>div': {
                          background: 'greys.light'
                        }
                      }}
                      cursor="pointer"
                      onClick={() => onType({ type })}
                      paddingY={1}
                    >
                      <Flex
                        alignItems="center"
                        flexDirection="row"
                        width="100%"
                        paddingRight={basePadding}
                        paddingLeft={basePadding * 2}
                        paddingY={basePadding / 2}
                      >
                        <Icon marginBottom="-2px" name={type?.icon || type?.key || type?.label || type} size={childIconSize}></Icon>
                        <Text marginTop="-2px" paddingLeft={2} fontSize="xs">
                          {type?.label || type?.key || type}
                        </Text>
                        {type?.wrap && (
                          <Flex
                            marginLeft="auto"
                            _hover={{
                              transform: 'scale(1.3)'
                            }}
                            transition="all 0.2s ease-out"
                            onClick={(e) => {
                              e?.preventDefault?.();
                              e?.stopPropagation?.();
                              // cancel bubble
                              e?.nativeEvent?.stopImmediatePropagation?.();
                              onType({
                                type,
                                wrap: true
                              });
                            }}
                          >
                            <Icon name="wrap" size={childIconSize}></Icon>
                          </Flex>
                        )}
                      </Flex>
                    </Flex>
                  );
                  return ret;
                })}
            </Flex>
            {!props?.readonly && props?.onDelete && (
              <Flex
                alignItems="center"
                flexDirection="row"
                _hover={{
                  background: 'greys.light'
                }}
                cursor="pointer"
                onClick={onDelete}
                paddingX={basePadding * 1}
                paddingY={basePadding / 2}
              >
                <Icon marginBottom="-2px" name="bin" size={childIconSize}></Icon>
                <Text marginTop="-2px" paddingLeft={2} fontSize="xs">
                  Recycle
                </Text>
              </Flex>
            )}
          </Flex>
        </Flex>
      </Center>
    </ClickAwayListener>
  );
};
