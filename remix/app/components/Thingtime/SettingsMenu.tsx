import React, { useState } from "react"
import { Center, Flex, Text } from "@chakra-ui/react"

import { Icon } from "../Icon/Icon"

export const SettingsMenu = (props) => {
  const [show, setShow] = useState(false)

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
    const ret = ["any", "object", "array", "string", "number", "boolean"]
    return ret
  }, [])

  const onChangeType = React.useCallback(
    (type) => {
      props?.onChangeType?.(type)
    },
    [props?.onChangeType]
  )

  const iconSize = 10

  return (
    <Center
      position="relative"
      opacity={props?.opacity}
      transition={props?.transition || "all 0.2s ease-in-out"}
      onMouseEnter={showMenu}
      onMouseLeave={hideMenu}
    >
      <Flex
        paddingLeft={1}
        // opacity={showContextIcon ? 1 : 0}
        cursor="pointer"
        transition="all 0.2s ease-in-out"
        // onClick={deleteValue}
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
          cursor="pointer"
          paddingY={basePadding}
        >
          {!props?.readonly && (
            <Flex
              alignItems="center"
              flexDirection="row"
              _hover={{
                background: "greys.light",
              }}
              paddingX={basePadding * 1}
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
                    onClick={() => onChangeType(type?.key || type)}
                    paddingY={1}
                  >
                    <Flex
                      alignItems="center"
                      flexDirection="row"
                      width="100%"
                      paddingX={basePadding * 2}
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
        </Flex>
      </Flex>
    </Center>
  )
}
