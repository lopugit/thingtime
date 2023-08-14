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

import { Commander } from "../Commander/Commander"
// import { Magic } from "../Commander/Magic"
import { Icon } from "../Icon/Icon"
import { MagicInput } from "../MagicInput/MagicInput"
import { Safe } from "../Safety/Safe"
import { SettingsMenu } from "./SettingsMenu"
import { useThingtime } from "./useThingtime"

import { getThing } from "~/smarts"

export const Thingtime = (props) => {
  // TODO: Add a circular reference seen prop check
  // and add button to expand circular reference
  // up to 1 level deep

  const { thingtime, setThingtime, getThingtime, loading } = useThingtime()

  const [uuid, setUuid] = React.useState(undefined)

  const [root, setRoot] = React.useState(props?.notRoot ? false : true)

  const [circular, setCircular] = React.useState(props?.circular)

  const editValueRef = React.useRef({})

  const depth = React.useMemo(() => {
    return props?.depth || 1
  }, [props?.depth])

  const pl = React.useMemo(() => {
    return props?.pl || [4, 6]
  }, [props?.pl])

  const pr = React.useMemo(() => {
    return props?.pr || (depth === 1 ? [4, 6] : 0)
  }, [props?.pr, depth])

  const multiplyPl = React.useCallback(
    (num) => {
      return pl.map((p) => p * num)
    },
    [pl]
  )

  const propsRef = React.useRef(props)

  React.useEffect(() => {
    propsRef.current = props
  }, [props])

  // will only run on the client
  React.useEffect(() => {
    setUuid(Math.random().toString(36).substring(7))
  }, [])

  const childrenRef = React.useRef([])

  const [thingDep, setThingDep] = React.useState(childrenRef.current)

  const createDependancies = () => {
    // push all children into childrenRef.current

    try {
      window.meta.db["createDependancies"] =
        window.meta.db["createDependancies"] || 0
      window.meta.db["createDependancies"]++
    } catch {}

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

  React.useEffect(() => {
    createDependancies()
  }, [])

  const thing = React.useMemo(() => {
    return props.thing
  }, [props.thing, childrenRef.current])

  const path = React.useMemo(() => {
    return props?.path?.key || props?.path || ""
  }, [props?.path])

  const fullPath = React.useMemo(() => {
    const ret = props?.fullPath || props?.path?.key || props?.path

    // store this thing in the global db
    try {
      window.meta.things[ret] = props?.thing
    } catch {
      // nothing
    }

    return ret
  }, [props?.fullPath, props?.path, props?.thing])

  const parentPath = React.useMemo(() => {
    const parentPath = fullPath?.split(".")?.slice(0, -1)?.join(".")

    if (!parentPath) {
      return "thingtime"
    }

    return parentPath
  }, [fullPath])

  const parent = React.useMemo(() => {
    return getThingtime(parentPath)
  }, [parentPath, getThingtime])

  React.useEffect(() => {
    console.log("thingtime changed in path", props?.fullPath)
    createDependancies()
  }, [thingtime, props?.fullPath, childrenRef])

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
    if (thing === null) {
      return "undefined"
    }
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
    } else if (type === "undefined") {
      return <Icon name="undefined" size={size}></Icon>
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
      return <MagicInput value={thing} readonly></MagicInput>
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
    } else if (type === "undefined") {
      return "Imagine.."
    } else {
      return "Something.."
    }
  }, [thing, thingDep, type, keys])

  const keysToUse = React.useMemo(() => {
    return keys
  }, [keys])
  // const keysToUse = flattenedKeys

  const template1Modes = React.useMemo(() => {
    return ["view", "edit"]
  }, [])

  const AtomicWrapper = React.useCallback((args) => {
    return (
      <Flex
        position="relative"
        flexDirection="row"
        flexShrink={1}
        width="100%"
        paddingLeft={args?.pl || args?.paddingLeft}
        fontSize="20px"
        border="none"
        // whiteSpace="pre-line"
        whiteSpace="pre-wrap"
        wordBreak={args?.wordBreak || "break-word"}
        outline="none"
        // paddingY={2}
        // dangerouslySetInnerHTML={{ __html: renderableValue }}
      >
        {args?.children}
      </Flex>
    )
  }, [])

  const thingtimeChildren = React.useMemo(() => {
    let inner = <AtomicWrapper paddingLeft={pl}>Imagine..</AtomicWrapper>
    if (keys?.length && !circular) {
      inner = (
        <>
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
        </>
      )
    }
    if (type === "object" && !circular) {
      return (
        <Safe {...props}>
          <Flex
            className="nested-things"
            position="relative"
            flexDirection="column"
            rowGap={9}
            // w={'500px'}
            // w={['200px', '500px']}
            maxWidth="100%"
            paddingLeft={valuePl}
            paddingY={props?.path ? 4 : 0}
          >
            {inner}
          </Flex>
        </Safe>
      )
    }
  }, [
    AtomicWrapper,
    keysToUse,
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
  ])

  const updateValue = React.useCallback(
    (args) => {
      const { value } = args

      setThingtime(fullPath, value)
    },
    [fullPath, setThingtime]
  )

  const resetValue = React.useCallback(() => {
    updateValue({ value: null })
  }, [updateValue])

  const onChangeType = React.useCallback(
    (type) => {
      const newType =
        type?.key || type?.value || type?.label || type?.icon || type

      if (newType === "object") {
        updateValue({ value: {} })
      } else if (newType === "array") {
        updateValue({ value: [] })
      } else if (newType === "string") {
        updateValue({ value: "" })
      } else if (newType === "number") {
        updateValue({ value: 0 })
      } else if (newType === "boolean") {
        updateValue({ value: false })
      } else if (newType === "undefined") {
        updateValue({ value: undefined })
      } else if (newType === "null") {
        updateValue({ value: null })
      } else if (newType === "any") {
        updateValue({ value: null })
      } else {
        console.error("Unknown type", newType)
      }
    },
    [updateValue]
  )

  const deleteValue = React.useCallback(() => {
    // use parent path to clone parent object but without this key
    const clone = { ...parent }

    delete clone[path]

    setThingtime(parentPath, clone)
  }, [path, parent, parentPath, setThingtime])

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
      if (type === "string") {
        return (
          <AtomicWrapper paddingLeft={pl} className="string-atomic-wrapper">
            <MagicInput
              value={thing}
              placeholder="Imagine.."
              onValueChange={updateValue}
            ></MagicInput>
            {/* <Box
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
            ></Box> */}
          </AtomicWrapper>
        )
      }
      if (type === "undefined") {
        return (
          <AtomicWrapper paddingLeft={pl}>
            {/* TODO: Implement UI-less commander */}
            <Commander
              // rainbow
              id={uuid}
              pathPrefix={fullPath}
              placeholder="Imagine.."
              // onValueChange={updateValue}
            ></Commander>
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
    renderableValue,
    pl,
    type,
    fullPath,
    uuid,
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
        <>
          <MagicInput
            value={renderedPath}
            readonly={!props?.edit}
            chakras={{
              maxWidth: "100%",
              paddingLeft: props?.pathPl || pl,
              fontSize: "12px",
              wordBreak: "break-all",
            }}
          ></MagicInput>
        </>
      )
    }
  }, [renderedPath, pl, props?.edit, props?.pathPl])

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

  const addNewChild = React.useCallback(() => {
    const newChild = null

    if (thing instanceof Array) {
      // add new child to array
      const newValue = [...thing, newChild]
      setThingtime(fullPath, newValue)
      return
    }

    const newChildBasePath = "New Value"
    // find increment that thing doesn't already have New Value N+1
    let increment = 0
    let newPath = newChildBasePath
    while (Object.hasOwnProperty.call(thing, newPath) && increment <= 999) {
      increment++
      newPath = newChildBasePath + " " + increment
    }
    const newChildPath = newPath
    const newChildFullPath = fullPath + "." + newChildPath
    // create new child on thing using setThingtime
    setThingtime(newChildFullPath, newChild)
  }, [fullPath, setThingtime, thing])

  const [showContextIcon, setShowContextIcon] = React.useState(false)

  return (
    <Safe {...props} depth={depth} uuid={uuid}>
      <Flex
        position="relative"
        flexDirection="column"
        // width="500px"
        rowGap={2}
        width={props?.width || props?.w || "100%"}
        maxWidth="100%"
        // marginTop={3}
        paddingRight={pr}
        // minW={depth === 1 ? '120px' : null}
        onMouseEnter={handleMouseEvent}
        onMouseLeave={handleMouseEvent}
        {...(props.chakras || {})}
        className={`thing uuid-${uuid}`}
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
                flexDirection="row"
                columnGap={1}
                marginTop={-1}
                paddingLeft={1}
              >
                <SettingsMenu
                  transition="all 0.2s ease-in-out"
                  opacity={showContextIcon ? 1 : 0}
                  uuid={uuid}
                  fullPath={fullPath}
                  readonly={!props?.edit}
                  onChangeType={onChangeType}
                  onDelete={deleteValue}
                ></SettingsMenu>
              </Flex>
            )}
          </Flex>
        </Flex>
        {/* {showContextMenu && contextMenu} */}
        {!loading && !thingtimeChildren && atomicValue && (
          <Box className="atomicValue">{atomicValue}</Box>
        )}
        {!loading && thingtimeChildren && (
          <Box className="thingtimeChildren">
            {thingtimeChildren}
            {type === "object" && (
              <Flex
                width="100%"
                paddingLeft={multiplyPl(2)}
                opacity={props?.edit ? 1 : 0}
                cursor="pointer"
                transition="all 0.2s ease-out"
                onClick={addNewChild}
                paddingY={2}
              >
                <Icon
                  _focus={{
                    outline: "none !important",
                    textShadow: "0px 0px 10px green",
                  }}
                  onKeyDown={(e) => {
                    if (e?.key === "Enter") {
                      addNewChild()
                    }
                  }}
                  tabIndex={0}
                  size={10}
                  name="seedling"
                ></Icon>
                {/* <Icon size={7} name="plus"></Icon>
          <Icon size={7} name="plus"></Icon> */}
              </Flex>
            )}
          </Box>
        )}
      </Flex>
    </Safe>
  )
}
