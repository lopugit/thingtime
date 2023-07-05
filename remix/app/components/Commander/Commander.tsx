import React from "react"
import ClickAwayListener from "react-click-away-listener"
import { Center, Flex, Input } from "@chakra-ui/react"

import { Rainbow } from "../Rainbow/Rainbow"
import { Thingtime } from "../Thingtime/Thingtime"
import { useThingtime } from "../Thingtime/useThingtime"

import { sanitise } from "~/functions/sanitise"
import { getParentPath } from "~/smarts"

export const Commander = (props) => {
  const { thingtime, setThingtime, getThingtime, thingtimeRef } = useThingtime()

  const inputRef = React.useRef()

  const [value, setValue] = React.useState("")
  const [active, setActive] = React.useState(false)
  const [contextPath, setContextPath] = React.useState()

  const [showContext, setShowContextState] = React.useState(false)

  const setShowContext = React.useCallback(
    (value, from?: string) => {
      setShowContextState(value)
    },
    [setShowContextState]
  )
  // const [suggestions, setSuggestions] = React.useState([])

  const contextValue = React.useMemo(() => {
    // TODO: Figure out why this is running on every click
    const ret = getThingtime(contextPath)
    return ret
  }, [contextPath, getThingtime])

  const commanderActive = React.useMemo(() => {
    return thingtime?.settings?.commanderActive
  }, [thingtime?.settings?.commanderActive])

  console.log("nik commanderActive", commanderActive)

  // commanderActive useEffect
  React.useEffect(() => {
    if (commanderActive) {
      inputRef?.current?.focus?.()
    } else {
      if (thingtimeRef?.current?.settings?.clearCommanderOnToggle) {
        setValue("")
      }
      if (thingtimeRef?.current?.settings?.clearCommanderContextOnToggle) {
        setShowContext(false, "commanderActive useEffect")
      }
    }
  }, [commanderActive, thingtimeRef, setShowContext])

  const onChange = React.useCallback((e) => {
    setValue(e.target.value)
  }, [])

  const validSetters = React.useMemo(() => {
    return ["=", " is "]
  }, [])

  const command = React.useMemo(() => {
    const sanitizedCommand = sanitise(value)

    if (sanitizedCommand?.includes(validSetters[0])) {
      const indexOfSplitter = sanitizedCommand?.indexOf(validSetters[0])
      const [pathRaw, valRaw] = [
        sanitizedCommand?.slice(0, indexOfSplitter),
        sanitizedCommand?.slice(indexOfSplitter + validSetters[0]?.length),
      ]
      return [pathRaw?.trim(), valRaw?.trim()]
    } else if (sanitizedCommand?.includes(validSetters[1])) {
      const indexOfSplitter = sanitizedCommand?.indexOf(validSetters[1])
      const [pathRaw, valRaw] = [
        sanitizedCommand?.slice(0, indexOfSplitter),
        sanitizedCommand?.slice(indexOfSplitter + validSetters[1]?.length),
      ]
      return [pathRaw?.trim(), valRaw?.trim()]
    }
    console.log("nik sanitizedCommand", sanitizedCommand)
    return [sanitizedCommand]
  }, [value, validSetters])

  const commandPath = React.useMemo(() => {
    return sanitise(command?.[0])
  }, [command])

  const commandValue = React.useMemo(() => {
    return command?.[1]
  }, [command])

  const commandContainsPath = React.useMemo(() => {
    console.log("nik command", commandPath)
    // const commandIncludesSuggestion = suggestions?.find(suggestion => {
    //   return commandPath?.includes(suggestion)
    // })
    // console.log('nik commandIncludesSuggestion', commandIncludesSuggestion)
    return false
    // return commandIncludesSuggestion
  }, [commandPath])

  const validQuotations = React.useMemo(() => {
    return ['"', "'"]
  }, [])

  const escapedCommandValue = React.useMemo(() => {
    // replace quotations with escaped quoations except for first and last quotation
    const startingQuotation = commandValue?.[0]
    const endingQuotation = commandValue?.[commandValue?.length - 1]
    const isQuoted =
      validQuotations?.includes(startingQuotation) &&
      validQuotations?.includes(endingQuotation)
    const restOfCommandValue = isQuoted
      ? commandValue?.slice(1, commandValue?.length - 1)
      : commandValue
    const escaped = restOfCommandValue
      ?.replace(/"/g, '\\"')
      ?.replace(/'/g, "\\'")
    const ret = `"${escaped}"`
    return ret
  }, [commandValue, validQuotations])

  const commandIsAction = React.useMemo(() => {
    return commandPath && commandValue
  }, [commandPath, commandValue])

  const suggestions = React.useMemo(() => {
    if (value?.length) {
      const suggestions = ["tt", "thingtime", "."]
      const populateSuggestions = (obj, path) => {
        Object.keys(obj).forEach((key) => {
          const val = obj[key]
          const newPath = path ? `${path}${path ? "." : ""}${key}` : key
          if (typeof val === "object") {
            suggestions.push(newPath)
            populateSuggestions(val, newPath)
          } else {
            suggestions.push(newPath)
          }
        })
      }

      // populateSuggestions(thingtime, commandPath)
      populateSuggestions(thingtime, "")

      // console.log('nik suggestions', suggestions)

      console.log("nik useEffect suggestions commandPath", commandPath)

      if (commandPath) {
        const filteredSuggestions = suggestions.filter((suggestion, i) => {
          return suggestion?.toLowerCase()?.includes(commandPath?.toLowerCase())
        })
        if (!filteredSuggestions?.includes(commandPath)) {
          const adjustedSuggestions = [commandPath, ...filteredSuggestions]
          return adjustedSuggestions
        } else {
          return filteredSuggestions
        }
      } else {
        return suggestions
      }

      // if (value) {
      //   setShowContext(true, 'Thingtime changes update suggestions')
      // }
    }
  }, [value, thingtime, commandPath])

  const onEnter = React.useCallback(
    (props) => {
      // if first characters of value equal tt. then run command
      // or if first character is a dot then run command
      try {
        console.log("Commander onEnter")
        if (commandIsAction) {
          // nothing
          try {
            const fn = `() => { return ${escapedCommandValue} }`
            const evalFn = eval(fn)
            const realVal = evalFn()
            const prevVal = getThingtime(commandPath)
            const parentPath = getParentPath(commandPath)
            setThingtime(commandPath, realVal)
            if (!prevVal) {
              setContextPath(parentPath)
              setShowContext(true, "commandIsAction check")
            }
          } catch (err) {
            console.log("setThingtime errored in Commander", err)
          }
        } else if (commandContainsPath) {
          console.log("Setting context path", commandPath)
          setContextPath(commandPath)
          setShowContext(true, "commandContainsPath check")
        }
      } catch (err) {
        console.error("Caught error on commander onEnter", err)
      }
    },
    [
      setShowContext,
      escapedCommandValue,
      setThingtime,
      getThingtime,
      commandIsAction,
      commandPath,
      commandContainsPath,
    ]
  )

  // trigger on enter
  const onKeyDown = React.useCallback(
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        onEnter({ e })
        // setThingtime(
        //   'settings.commanderActive',
        //   !thingtime?.settings?.commanderActive
        // )
      }
    },
    [onEnter]
  )

  const openCommander = React.useCallback(() => {
    console.log("nik commander opening commander")
    setThingtime("settings.commanderActive", true)
  }, [setThingtime])

  const closeCommander = React.useCallback(() => {
    if (thingtime?.settings?.commanderActive) {
      console.log("nik commander closing commander")
      setThingtime("settings.commanderActive", false)
    }

    document.activeElement.blur()

    if (value !== "") {
      setValue("")
    }
    if (contextPath !== undefined) {
      setContextPath(undefined)
    }
    if (showContext !== false) {
      setShowContext(false)
    }
  }, [
    setThingtime,
    setShowContext,
    value,
    contextPath,
    showContext,
    thingtime?.settings?.commanderActive,
  ])

  const toggleCommander = React.useCallback(() => {
    if (thingtime?.settings?.commanderActive) {
      closeCommander()
    } else {
      openCommander()
    }
  }, [thingtime?.settings?.commanderActive, closeCommander, openCommander])

  React.useEffect(() => {
    const keyListener = (e: any) => {
      if (e?.metaKey && e?.code === "KeyP") {
        e.preventDefault()
        e.stopPropagation()
        toggleCommander()
      }
      // if key escape close all modals
      console.log("commander key listener e?.code", e?.code)
      if (e?.code === "Escape") {
        closeCommander()
      }
    }

    window.addEventListener("keydown", keyListener)

    return () => {
      window.removeEventListener("keydown", keyListener)
    }
  }, [setThingtime, thingtime, toggleCommander, closeCommander])

  const selectSuggestion = React.useCallback(
    (suggestion) => {
      setValue(suggestion)
      setContextPath(suggestion)
      setShowContext(true, "Select suggestion")
    },
    [setValue, setContextPath, setShowContext]
  )

  const excludedSuggestions = React.useMemo(() => {
    return ["."]
  }, [])

  const renderedSuggestions = React.useMemo(() => {
    return suggestions?.filter((suggestion) => {
      return !excludedSuggestions?.includes(suggestion)
    })
  }, [suggestions, excludedSuggestions])

  const mobileVW = React.useMemo(() => {
    return "calc(100vw - 45px)"
  }, [])

  const rainbowRepeats = 1

  return (
    <ClickAwayListener onClickAway={closeCommander}>
      <Flex
        position="absolute"
        top={0}
        right={0}
        // zIndex={99999}
        // position='fixed'
        // top='100px'
        left={0}
        justifyContent={["flex-start", "center"]}
        // display={["flex", commanderActive ? "flex" : "none"]}
        maxWidth="100%"
        height="100%"
        pointerEvents="none"
        id="commander"
        paddingX={1}
        paddingY={1}
      >
        <Flex
          position="absolute"
          top="100%"
          right={0}
          left={0}
          alignItems={["flex-start", "center"]}
          flexDirection="column"
          overflowY="scroll"
          maxWidth="100%"
          height="auto"
          maxHeight="90vh"
          marginTop={2}
          borderRadius="12px"
          marginX={1}
        >
          <Flex
            flexDirection="column"
            display={renderedSuggestions?.length ? "flex" : "none"}
            width={["100%", "400px"]}
            maxWidth="100%"
            marginBottom={3}
            background="grey"
            borderRadius="12px"
            pointerEvents="all"
            id="commander-suggestions"
            paddingY={3}
          >
            {renderedSuggestions?.map((suggestion, i) => {
              return (
                <Flex
                  key={i}
                  _hover={{
                    bg: "greys.medium",
                  }}
                  cursor="pointer"
                  onClick={() => selectSuggestion(suggestion)}
                  paddingX={4}
                >
                  {suggestion}
                </Flex>
              )
            })}
          </Flex>
          <Flex
            display={showContext ? "flex" : "none"}
            maxWidth="100%"
            background="grey"
            borderRadius="12px"
            pointerEvents="all"
            paddingY={3}
          >
            <Thingtime thing={contextValue}></Thingtime>
          </Flex>
        </Flex>
        <Center
          position="relative"
          width={["100%", "400px"]}
          maxWidth={[mobileVW, "100%"]}
          height="100%"
        >
          <Rainbow
            filter="blur(15px)"
            opacity={commanderActive ? 0.25 : 0}
            repeats={rainbowRepeats}
            thickness={8}
            overflow="visible"
          >
            <Center
              position="relative"
              overflow="hidden"
              width={["100%", "400px"]}
              maxWidth={[mobileVW, "100%"]}
              height="100%"
              padding="1px"
              borderRadius="6px"
              pointerEvents="all"
              outline="none"
            >
              <Rainbow
                opacity={commanderActive ? 0.5 : 0}
                position="absolute"
                repeats={rainbowRepeats}
                opacityTransition="all 3000ms ease"
                thickness={10}
              ></Rainbow>
              <Input
                // display='none'
                // opacity={0}
                ref={inputRef}
                sx={{
                  "&::placeholder": {
                    color: "greys.dark",
                  },
                }}
                width="100%"
                height="100%"
                background="grey"
                border="none"
                borderRadius="5px"
                outline="none"
                onChange={onChange}
                onFocus={openCommander}
                onKeyDown={onKeyDown}
                placeholder={"What's on your mind?"}
                value={value}
              ></Input>
            </Center>
          </Rainbow>
        </Center>
      </Flex>
    </ClickAwayListener>
  )
}
