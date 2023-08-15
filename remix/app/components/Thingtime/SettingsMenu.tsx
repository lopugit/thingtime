import React, { useState } from "react"
import ClickAwayListener from "react-click-away-listener"
import { Center, Flex, Text } from "@chakra-ui/react"

import { Icon } from "../Icon/Icon"

export const SettingsMenu = (props) => {
  const [show, setShow] = useState(false)
  const hideRef = React.useRef(null)
  const [opacity, setOpacity] = React.useState(props?.opacity === 0 ? 0 : 1)

  const opacityRef = React.useRef(null)

  const waitTime = 1555

  React.useEffect(() => {
    clearInterval(opacityRef?.current)
    if (props?.opacity) {
      setOpacity(props?.opacity)
    } else {
      opacityRef.current = setInterval(() => {
        setOpacity(props?.opacity)
        setShow(false)
      }, waitTime)
    }
  }, [props?.opacity])

  React.useEffect(() => {
    if (show || props?.opacity) {
      clearInterval(hideRef?.current)
    }
  }, [show, props?.opacity])

  const maybeHide = React.useCallback(() => {
    clearInterval(hideRef?.current)
    hideRef.current = setTimeout(() => {
      setShow(false)
    }, waitTime)
  }, [])

  const showMenu = React.useCallback(() => {
    setShow(true)
  }, [])

  const hideMenu = React.useCallback(() => {
    setShow(false)
  }, [])

  const basePadding = React.useMemo(() => {
    return 4
  }, [])

  const types = React.useMemo(() => {
    const ret = [
      { label: "any", icon: "any" },
      "object",
      "array",
      "string",
      "number",
      "boolean",
    ]
    return ret
  }, [])

  const onChangeType = React.useCallback(
    (type) => {
      props?.onChangeType?.(type)
    },
    [props?.onChangeType]
  )
  const onDelete = React.useCallback(
    (type) => {
      props?.onDelete?.()
    },
    [props?.onDelete]
  )

  const iconSize = 10

  return (
    <ClickAwayListener onClickAway={hideMenu}>
      <Center
        position="relative"
        // width="100%"
        paddingRight={36}
        opacity={opacity}
        transition={props?.transition || "all 0.2s ease-in-out"}
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
          <Icon name="wizard" size={7}></Icon>
        </Flex>
        <Flex
          position="absolute"
          zIndex={999}
          top="100%"
          left={0}
          flexDirection="column"
          opacity={show ? 1 : 0}
          pointerEvents={show ? "all" : "none"}
        >
          <Flex
            flexDirection="column"
            // rowGap={basePadding / 3}
            background="greys.lightt"
            borderRadius={4}
            boxShadow={props?.boxShadow || "0px 2px 7px 0px rgba(0,0,0,0.2)"}
            paddingY={basePadding}
          >
            {!props?.readonly && (
              <Flex
                alignItems="center"
                flexDirection="row"
                paddingRight={basePadding * 2}
                paddingLeft={basePadding * 1}
                _hover={{
                  background: "greys.light",
                }}
                cursor="pointer"
                // paddingX={basePadding * 1}
                paddingY={basePadding / 2}
              >
                <Icon marginBottom="-2px" name="cyclone" size={iconSize}></Icon>
                <Text marginTop="-2px" paddingLeft={2} fontSize="xs">
                  Types
                </Text>
              </Flex>
            )}
            <Flex
              flexDirection="column"
              // rowGap={basePadding}
              background="greys.lightt"
              cursor="pointer"
            >
              {!props?.readonly &&
                types.map((type, idx) => {
                  const ret = (
                    <Flex
                      key={props?.uuid + props?.fullPath + "-type-menu-" + idx}
                      width="100%"
                      _hover={{
                        "&>div": {
                          background: "greys.light",
                        },
                      }}
                      cursor="pointer"
                      onClick={() => onChangeType(type?.key || type)}
                      paddingY={1}
                    >
                      <Flex
                        alignItems="center"
                        flexDirection="row"
                        width="100%"
                        paddingRight={basePadding * 4}
                        paddingLeft={basePadding * 2}
                        paddingY={basePadding / 2}
                      >
                        <Icon
                          marginBottom="-2px"
                          name={type?.icon || type?.key || type?.label || type}
                          size={iconSize}
                        ></Icon>
                        <Text marginTop="-2px" paddingLeft={2} fontSize="xs">
                          {type?.label || type?.key || type}
                        </Text>
                      </Flex>
                    </Flex>
                  )
                  return ret
                })}
            </Flex>
            {!props?.readonly && (
              <Flex
                alignItems="center"
                flexDirection="row"
                _hover={{
                  background: "greys.light",
                }}
                cursor="pointer"
                onClick={onDelete}
                paddingX={basePadding * 1}
                paddingY={basePadding / 2}
              >
                <Icon marginBottom="-2px" name="bin" size={iconSize}></Icon>
                <Text marginTop="-2px" paddingLeft={2} fontSize="xs">
                  Recycle
                </Text>
              </Flex>
            )}
          </Flex>
        </Flex>
      </Center>
    </ClickAwayListener>
  )
}
