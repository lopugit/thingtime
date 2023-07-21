import React from "react"
import { Box, Flex } from "@chakra-ui/react"

import { Icon } from "../Icon/Icon"
import { Safe } from "../Safety/Safe"
import { useThingtime } from "./useThingtime"

export const Thingtime = (props) => {
  // TODO: Add a circular reference seen prop check
  // and add button to expand circular reference
  // up to 1 level deep

  const { thingtime } = useThingtime()

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
      const keysRet = Object.keys(thing)
      return keysRet
    } else {
      return []
    }
  }, [thing, validKeyTypes])

  const type = React.useMemo(() => {
    return typeof thing
  }, [thing])

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
        return <Box onClick={() => setCircular(false)}>Click to Expand</Box>
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

  const value = React.useMemo(() => {
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

                  return (
                    <Thingtime
                      key={idx}
                      seen={nextSeen}
                      circular={seen?.includes?.(nextThing)}
                      depth={depth + 1}
                      parent={thing}
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

  const editableValue = React.useMemo(() => {
    if (template1Modes?.includes(mode)) {
      return (
        <Box
          paddingLeft={pl}
          fontSize="20px"
          border="none"
          whiteSpace="pre-line"
          outline="none"
          contentEditable={mode === "edit"}
          paddingY={2}
          // dangerouslySetInnerHTML={{ __html: renderableValue }}
        >
          {renderableValue}
        </Box>
      )
    }
  }, [renderableValue, mode, template1Modes, pl])

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
    if (humanPath?.includes?.("hidden")) {
      return null
    }
    if (humanPath?.includes?.("unique")) {
      // take only path from before the string unique
      return humanPath.split?.("unique")?.[0]
    }

    return humanPath
  }, [humanPath])

  const path = React.useMemo(() => {
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
          {path}
          <Flex position="absolute" top={0} right={0}>
            <Icon name="gear"></Icon>
          </Flex>
        </Flex>
        {/* {showContextMenu && contextMenu} */}
        {!value && editableValue}
        {value}
      </Flex>
    </Safe>
  )
}
