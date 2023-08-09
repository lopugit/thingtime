import React from "react"
import ContentEditable from "react-contenteditable"
import {
  Box,
  Center,
  Flex,
  Input,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Select,
  Spinner,
  Switch,
  Textarea,
} from "@chakra-ui/react"

import { Icon } from "../Icon/Icon"
import { Safe } from "../Safety/Safe"
import { useThingtime } from "./useThingtime"

export const Thingtime = (props) => {
  // TODO: Add a circular reference seen prop check
  // and add button to expand circular reference
  // up to 1 level deep

  const { thingtime, setThingtime, loading } = useThingtime()

  const [uuid, setUuid] = React.useState()

  const [root, setRoot] = React.useState(props?.notRoot ? false : true)

  const [circular, setCircular] = React.useState(props?.circular)

  const contentEditableRef = React.useRef(null)
  const editValueRef = React.useRef({})

  const childrenRef = React.useRef([])

  const [thingDep, setThingDep] = React.useState(childrenRef.current)

  const createDependancies = () => {
    // push all children into childrenRef.current
    try {
      const values = Object.values(props?.thing)
      // if childrenRef.current does not shallow equal values then replace with array of values
      const valuesNotEqual =
        values?.length !== childrenRef.current?.length ||
        !values?.every?.((value, idx) => {
          return childrenRef.current[idx] === value
        })
      if (valuesNotEqual) {
        childrenRef.current = values
        setThingDep(childrenRef.current)
      }
    } catch {
      // nothing
    }
  }

  createDependancies()

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
  }, [props.thing, childrenRef.current])

  React.useEffect(() => {
    console.log("thingtime changed in path", props?.fullPath)
    createDependancies()
  }, [thingtime, props?.fullPath, childrenRef])

  const fullPath = React.useMemo(() => {
    return props?.fullPath || props?.path
  }, [props?.fullPath, props?.path])

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
  }, [thing, thingDep, validKeyTypes])

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
  }, [thing, thingDep, type, keys])

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
        const ret = (
          <Safe {...props}>
            <Flex
              className="nested-things"
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
                      edit={props?.edit}
                      circular={seen?.includes?.(nextThing)}
                      depth={depth + 1}
                      parent={thing}
                      notRoot
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
        return ret
      }
    }
  }, [
    keysToUse,
    mode,
    circular,
    seen,
    type,
    fullPath,
    depth,
    thing,
    thingDep,
    props,
    valuePl,
    pl,
    keys,
    template1Modes,
  ])

  const AtomicWrapper = React.useCallback((props) => {
    return (
      <Flex
        flexDirection="row"
        flexShrink={1}
        width="100%"
        paddingLeft={props?.pl || props?.paddingLeft}
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
  }, [])

  const [contentEditableThing, setContentEditableThing] = React.useState(thing)

  const updateContentEditableThing = React.useCallback((value) => {
    // replace all new line occurences in value with <div><br></div>

    // extract all series of new lines
    const newlines = value?.split?.(/[^\n]/)?.filter((v) => v !== "")

    let newValue = value

    // replace all new lines groups with <div><br></div>
    newlines?.forEach?.((newline) => {
      const baseLength = "\n"?.length

      const newlineClone = newline

      const newlineClonePart1 = newlineClone?.replace(
        "\n\n\n",
        "<div><br /></div>"
      )
      const newlineClonePart2 = newlineClonePart1?.replace(
        /\n\n/g,
        "<div><br /></div>"
      )
      const newlineClonePart3 = newlineClonePart2?.replace(/\n/g, "<br />")

      newValue = newValue?.replace(newline, newlineClonePart3)
    })

    setContentEditableThing(newValue)
  }, [])

  React.useEffect(() => {
    const entries = Object.entries(editValueRef.current)
    const propsThingInEntries = entries?.find?.(
      (entry) => entry[1] === props?.thing
    )
    if (!propsThingInEntries) {
      updateContentEditableThing(props?.thing)
      // setContentEditableThing(props?.thing)
    } else {
      const [time, value] = propsThingInEntries
      if (time && value) {
        delete editValueRef.current[time]
      }
    }
  }, [props?.thing, updateContentEditableThing])

  const updateValue = React.useCallback(
    (args) => {
      const { value } = args

      setThingtime(fullPath, value)
    },
    [fullPath, setThingtime]
  )

  const atomicValue = React.useMemo(() => {
    if (props?.edit) {
      if (type === "boolean") {
        return (
          <AtomicWrapper paddingLeft={pl} className="boolean-atomic-wrapper">
            <Box
              onClick={(e) => {
                e?.preventDefault?.()
                e?.stopPropagation?.()
                // cancel bubble
                e?.nativeEvent?.stopImmediatePropagation?.()
                setTimeout(() => {
                  updateValue({ value: !thing })
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
          <AtomicWrapper paddingLeft={pl} className="number-atomic-wrapper">
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
      if (type === "string" && typeof contentEditableThing === "string") {
        return (
          <AtomicWrapper paddingLeft={pl} className="string-atomic-wrapper">
            <Box
              ref={contentEditableRef}
              width="100%"
              border="none"
              outline="none"
              contentEditable={true}
              dangerouslySetInnerHTML={{ __html: contentEditableThing }}
              onInput={(value) => {
                const innerText = value?.target?.innerText
                if (typeof innerText === "string") {
                  const time = Date.now()
                  editValueRef.current[time] = innerText
                  updateValue({ value: innerText })
                }
              }}
            ></Box>
          </AtomicWrapper>
        )
      }
    }

    return (
      <AtomicWrapper paddingLeft={pl} className="default-atomic-wrapper">
        {renderableValue}
      </AtomicWrapper>
    )
  }, [
    contentEditableThing,
    renderableValue,
    pl,
    type,
    AtomicWrapper,
    props?.edit,
    thing,
    thingDep,
    updateValue,
  ])

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
        className={`thing uuid-${uuid?.current}`}
        data-path={props?.path}
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
        {!loading && !thingtimeChildren && atomicValue && (
          <Box className="atomicValue">{atomicValue}</Box>
        )}
        {!loading && thingtimeChildren && (
          <Box className="thingtimeChildren">{thingtimeChildren}</Box>
        )}
      </Flex>
    </Safe>
  )
}
