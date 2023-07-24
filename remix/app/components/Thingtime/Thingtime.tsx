import React from "react"
import {
  Box,
  Flex,
  Input,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Select,
  Switch,
} from "@chakra-ui/react"

import { Icon } from "../Icon/Icon"
import { Safe } from "../Safety/Safe"
import { useThingtime } from "./useThingtime"

export const Thingtime = (props) => {
  // TODO: Add a circular reference seen prop check
  // and add button to expand circular reference
  // up to 1 level deep

  const { thingtime, setThingtime } = useThingtime()

  const [uuid, setUuid] = React.useState()

  const [circular, setCircular] = React.useState(props?.circular)

  const depth = React.useMemo(() => {
    return props?.depth || 1
  }, [props?.depth])

  const pl = React.useMemo(() => {
    return props?.pl || [4, 6]
  }, [props?.pl])

  const pr = React.useMemo(() => {
    return props?.pr || (depth === 1 ? [4, 6] : 0)
  }, [props?.pr, depth])

  // will only run on the client
  React.useEffect(() => {
    setUuid(Math.random().toString(36).substring(7))
  }, [])

  const thing = React.useMemo(() => {
    return props.thing
  }, [props.thing])

  const seen = React.useMemo(() => {
    if (props?.seen instanceof Array) {
      if (props?.seen?.includes(thing)) {
        return props?.seen
      } else if (typeof thing === "object") {
        return [...props.seen, thing]
      }
      return props?.seen || []
    }
    if (typeof thing === "object") {
      return [thing]
    }
    return []
  }, [props?.seen, thing])

  const mode = React.useMemo(() => {
    return "view"
  }, [])

  const validKeyTypes = React.useMemo(() => {
    return ["object", "array"]
  }, [])

  const keys = React.useMemo(() => {
    if (validKeyTypes?.includes(typeof thing)) {
      try {
        const keysRet = Object.keys(thing)
        return keysRet
      } catch {
        // nothing
      }
    } else {
      return []
    }
  }, [thing, validKeyTypes])

  const type = React.useMemo(() => {
    return typeof thing
  }, [thing])

  const typeIcon = React.useMemo(() => {
    const size = 7
    if (thing instanceof Array) {
      return <Icon name="array" size={size}></Icon>
    } else if (type === "object") {
      return <Icon name="object" size={size}></Icon>
    } else if (type === "string") {
      return <Icon name="string" size={size}></Icon>
    } else if (type === "number") {
      return <Icon name="number" size={size}></Icon>
    } else if (type === "boolean") {
      return <Icon name="boolean" size={size}></Icon>
    } else {
      return <Icon name="box" size={size}></Icon>
    }
  }, [type, thing])

  const valuePl = React.useMemo(() => {
    if (typeof props?.valuePl === "number") {
      return props?.valuePl
    }
    return props?.path ? [4, 6] : [0, 0]
  }, [props?.valuePl, props?.path])

  const renderableValue = React.useMemo(() => {
    if (type === "string") {
      const trimmed = thing.trim()

      if (!trimmed) {
        return ""
      }
      return trimmed
    } else if (type === "number") {
      return thing
    } else if (type === "boolean") {
      return thing ? "true" : "false"
    } else if (type === "object") {
      if (thing === null) {
        return "null"
      }
      if (!keys?.length) {
        return "Something!"
      }

      try {
        return JSON.stringify(thing, null, 2)
      } catch (err) {
        // console.error(
        //   "Caught error making renderableValue of thing",
        //   err,
        //   thing
        // )
        return (
          <Box cursor="pointer" onClick={() => setCircular(false)}>
            Click to Expand
          </Box>
        )
      }
    } else {
      return "Something!"
    }
  }, [thing, type, keys])

  const keysToUse = React.useMemo(() => {
    return keys
  }, [keys])
  // const keysToUse = flattenedKeys

  const template1Modes = React.useMemo(() => {
    return ["view", "edit"]
  }, [])

  const thingtimeChildren = React.useMemo(() => {
    if (template1Modes?.includes(mode)) {
      if (keys?.length && !circular) {
        return (
          <Safe {...props}>
            <Flex
              position="relative"
              flexDirection="column"
              // w={'500px'}
              // w={['200px', '500px']}
              maxWidth="100%"
              paddingLeft={valuePl}
              paddingY={props?.path ? 3 : 0}
            >
              {keysToUse?.length &&
                keysToUse.map((key, idx) => {
                  if (!key?.human) {
                    key = {
                      human: key,
                      key: key,
                    }
                  }

                  const nextThing = thing[key?.key]

                  const nextSeen = [...seen]

                  if (typeof nextThing === "object") {
                    nextSeen.push(nextThing)
                  }

                  const fullPath = props?.fullPath || props?.path

                  return (
                    <Thingtime
                      key={idx}
                      seen={nextSeen}
                      edit={props?.edit}
                      circular={seen?.includes?.(nextThing)}
                      depth={depth + 1}
                      parent={thing}
                      fullPath={fullPath + "." + key?.key}
                      path={key}
                      thing={nextThing}
                      // thing={{ infinite: { yes: true } }}
                      valuePl={pl}
                    ></Thingtime>
                  )
                })}
            </Flex>
          </Safe>
        )
      }
    }
  }, [
    keysToUse,
    mode,
    circular,
    seen,
    depth,
    thing,
    props,
    valuePl,
    pl,
    keys,
    template1Modes,
  ])

  const AtomicWrapper = React.useCallback(
    (props) => {
      return (
        <Flex
          flexDirection="row"
          flexShrink={1}
          paddingLeft={pl}
          fontSize="20px"
          border="none"
          whiteSpace="pre-line"
          outline="none"
          paddingY={2}
          // dangerouslySetInnerHTML={{ __html: renderableValue }}
        >
          {props?.children}
        </Flex>
      )
    },
    [pl]
  )

  const updateValue = React.useCallback(
    (args) => {
      const { value } = args

      console.log("nik value", value)
      console.log("nik props?.fullPath", props?.fullPath)

      setThingtime(props?.fullPath, value)
    },
    [props?.fullPath, setThingtime]
  )

  const atomicValue = React.useMemo(() => {
    if (props?.edit) {
      if (type === "boolean") {
        return (
          <AtomicWrapper>
            <Box
              onClick={(e) => {
                e?.preventDefault?.()
                e?.stopPropagation?.()
                // cancel bubble
                e?.nativeEvent?.stopImmediatePropagation?.()
                console.log("nik 123123 clicked", !thing)
                setTimeout(() => {
                  updateValue({ value: !thing })
                  console.log("nik 123123 changed", e)
                }, 1)
              }}
            >
              <Switch isChecked={thing}></Switch>
            </Box>
          </AtomicWrapper>
        )
      }
      if (type === "number") {
        const numberPxLength = thing?.toString()?.length * 13 + 30
        return (
          <AtomicWrapper>
            <Flex>
              <NumberInput
                alignItems="center"
                justifyContent="center"
                onChange={(value) => {
                  setTimeout(() => {
                    try {
                      const number = Number(value)
                      console.log("typeof number", typeof number)
                      updateValue({ value: number })
                    } catch {
                      // something went wrong casting to number
                    }
                  }, 1)
                }}
                value={thing}
              >
                <NumberInputField width={numberPxLength + "px"} />
                <NumberInputStepper transform="scale(0.9)">
                  <NumberIncrementStepper
                  // transform="scale(0.7)"
                  />
                  <NumberDecrementStepper
                  // transform="scale(0.7)"
                  />
                </NumberInputStepper>
              </NumberInput>
            </Flex>
          </AtomicWrapper>
        )
      }
    }
    return <AtomicWrapper>{renderableValue}</AtomicWrapper>
  }, [renderableValue, AtomicWrapper, type, props?.edit, thing, updateValue])

  const contextMenu = (
    <Flex
      position="absolute"
      top={0}
      right={0}
      paddingRight={4}
      userSelect="none"
    >
      Settings
    </Flex>
  )

  const [showContextMenu, setShowContextMenu] = React.useState(false)

  const humanPath = React.useMemo(() => {
    if (typeof props?.path === "string") {
      return props?.path
    }
    return props?.path?.human || ""
  }, [props?.path])

  const renderedPath = React.useMemo(() => {
    if (props?.edit) {
      return humanPath
    }

    if (humanPath?.includes?.("hidden")) {
      return null
    }
    if (humanPath?.includes?.("unique")) {
      // take only path from before the string unique
      return humanPath.split?.("unique")?.[0]
    }

    return humanPath
  }, [humanPath, props?.edit])

  const pathDom = React.useMemo(() => {
    if (renderedPath) {
      return (
        <Flex
          maxWidth="100%"
          paddingLeft={props?.pathPl || pl}
          fontSize="12px"
          wordBreak="break-all"
        >
          {renderedPath}
        </Flex>
      )
    }
  }, [renderedPath, pl, props?.pathPl])

  const handleMouseEvent = React.useCallback(
    (e) => {
      const target = e?.target
      // extract uuid from className
      const className = target?.className
      if (className?.includes(uuid?.current)) {
        setShowContextMenu(e?.type === "mouseenter")
      }
    },
    [uuid]
  )

  const [showContextIcon, setShowContextIcon] = React.useState(false)

  return (
    <Safe {...props} depth={depth} uuid={uuid?.current}>
      <Flex
        position="relative"
        flexDirection="column"
        // width="500px"
        width={props?.width || props?.w || "100%"}
        maxWidth="100%"
        paddingRight={pr}
        onMouseEnter={handleMouseEvent}
        onMouseLeave={handleMouseEvent}
        // minW={depth === 1 ? '120px' : null}
        paddingY={3}
        {...(props.chakras || {})}
        className={`thing-${uuid?.current}`}
      >
        {/* {uuid?.current} */}
        <Flex position="relative" flexDirection="row">
          <Flex
            alignItems="center"
            flexDirection="row"
            marginRight="auto"
            onMouseEnter={() => setShowContextIcon(true)}
            onMouseLeave={() => setShowContextIcon(false)}
          >
            <Flex>{pathDom}</Flex>
            {props?.edit && (
              <Box
                // marginTop={-3}
                marginTop={-1}
                paddingLeft={1}
                opacity={0.5}
                cursor="pointer"
              >
                {typeIcon}
              </Box>
            )}
            {pathDom && (
              <Flex
                paddingLeft={1}
                opacity={showContextIcon ? 1 : 0}
                cursor="pointer"
                transition="all 0.2s ease-in-out"
              >
                <Icon name="magic" size={10}></Icon>
              </Flex>
            )}
          </Flex>
        </Flex>
        {/* {showContextMenu && contextMenu} */}
        {!thingtimeChildren && atomicValue}
        {thingtimeChildren}
      </Flex>
    </Safe>
  )
}
