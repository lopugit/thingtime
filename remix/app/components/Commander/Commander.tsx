import React from 'react'
import { Center, Box, Flex, Input } from '@chakra-ui/react'
import { useThingtime } from '../Thingtime/useThingtime'
import { Thingtime } from '../Thingtime/Thingtime'
import { sanitise } from '~/functions/path'
import ClickAwayListener from 'react-click-away-listener'

export const Commander = props => {
  const { thingtime, setThingtime, getThingtime, thingtimeRef } = useThingtime()

  const inputRef = React.useRef()

  const [value, setValue] = React.useState('')

  const [contextPath, setContextPath] = React.useState()

  const [showContext, setShowContextState] = React.useState(false)

  const setShowContext = React.useCallback(
    (value, from) => {
      setShowContextState(value)
    },
    [setShowContextState]
  )
  const [suggestions, setSuggestions] = React.useState([])

  const contextValue = React.useMemo(() => {
    console.log('thingtime updated!')
    const ret = getThingtime(contextPath)
    return ret
  }, [contextPath, getThingtime])

  const showCommander = React.useMemo(() => {
    return thingtime?.settings?.showCommander
  }, [thingtime?.settings?.showCommander])

  // watch value
  React.useEffect(() => {
    if (!value?.length) {
      setSuggestions([])
    }
  }, [value])

  // showCommander useEffect
  React.useEffect(() => {
    if (showCommander) {
      inputRef?.current?.focus?.()
    } else {
      if (thingtimeRef?.current?.settings?.clearCommanderOnToggle) {
        setValue('')
      }
      if (thingtimeRef?.current?.settings?.clearCommanderContextOnToggle) {
        setShowContext(false, 'showCommander useEffect')
      }
    }
  }, [showCommander, thingtimeRef, setShowContext])

  const onChange = React.useCallback(e => {
    setValue(e.target.value)
  }, [])

  const validSetters = React.useMemo(() => {
    return ['=', ' is ']
  }, [])

  const command = React.useMemo(() => {
    const sanitizedCommand = sanitise(value)

    if (sanitizedCommand?.includes(validSetters[0])) {
      const indexOfSplitter = sanitizedCommand?.indexOf(validSetters[0])
      const [pathRaw, valRaw] = [
        sanitizedCommand?.slice(0, indexOfSplitter),
        sanitizedCommand?.slice(indexOfSplitter + validSetters[0]?.length)
      ]
      return [pathRaw?.trim(), valRaw?.trim()]
    } else if (sanitizedCommand?.includes(validSetters[1])) {
      const indexOfSplitter = sanitizedCommand?.indexOf(validSetters[1])
      const [pathRaw, valRaw] = [
        sanitizedCommand?.slice(0, indexOfSplitter),
        sanitizedCommand?.slice(indexOfSplitter + validSetters[1]?.length)
      ]
      return [pathRaw?.trim(), valRaw?.trim()]
    }
    return [sanitizedCommand]
  }, [value, validSetters])

  const commandContainsPath = React.useMemo(() => {
    const suggestionsIncludesSubstring = suggestions?.find(suggestion => {
      return command?.includes(suggestion)
    })
    return suggestionsIncludesSubstring
  }, [suggestions, command])

  const commandPath = React.useMemo(() => {
    return command?.[0]
  }, [command])

  const commandValue = React.useMemo(() => {
    return command?.[1]
  }, [command])

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

  // thingtime changes update suggestions
  React.useEffect(() => {
    // when thingtime changes, update suggestions
    // with all flattened key path values recursively

    if (value?.length) {
      const suggestions = ['tt', 'thingtime', '.']
      const recurse = (obj, path) => {
        Object.keys(obj).forEach(key => {
          const val = obj[key]
          const newPath = path ? `${path}.${key}` : key
          if (typeof val === 'object') {
            suggestions.push(newPath)
            recurse(val, newPath)
          } else {
            suggestions.push(newPath)
          }
        })
      }
      recurse(thingtime, '')

      if (commandPath) {
        const filteredSuggestions = suggestions.filter((suggestion, i) => {
          return suggestion?.toLowerCase()?.includes(commandPath?.toLowerCase())
        })
        if (!filteredSuggestions?.includes(commandPath)) {
          const adjustedSuggestions = [commandPath, ...filteredSuggestions]
          setSuggestions(adjustedSuggestions)
        } else {
          setSuggestions(filteredSuggestions)
        }
      } else {
        setSuggestions(suggestions)
      }

      // if (value) {
      //   setShowContext(true, 'Thingtime changes update suggestions')
      // }
    }
  }, [thingtime, value, commandPath, setShowContext])

  const onEnter = React.useCallback(
    props => {
      // if first characters of value equal tt. then run command
      // or if first character is a dot then run command
      try {
        if (commandIsAction) {
          // nothing
          try {
            const fn = `() => { return ${escapedCommandValue} }`
            const evalFn = eval(fn)
            const realVal = evalFn()
            const prevVal = getThingtime(commandPath)
            setThingtime(commandPath, realVal)
            if (!prevVal) {
              setContextPath(commandPath)
              setShowContext(true, 'commandIsAction check')
            }
          } catch (err) {
            console.log('setThingtime errored in Commander', err)
          }
        } else if (commandContainsPath) {
          setContextPath(commandPath)
          setShowContext(true, 'commandContainsPath check')
        }
      } catch (err) {
        console.error('Caught error on commander onEnter', err)
      }
    },
    [
      setShowContext,
      escapedCommandValue,
      setThingtime,
      commandIsAction,
      commandPath,
      commandContainsPath
    ]
  )

  // trigger on enter
  const onKeyDown = React.useCallback(
    e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onEnter({ e })
        // setThingtime(
        //   'settings.showCommander',
        //   !thingtime?.settings?.showCommander
        // )
      }
    },
    [onEnter]
  )

  const openCommander = React.useCallback(() => {
    setThingtime('settings.showCommander', true)
  }, [setThingtime])

  const closeCommander = React.useCallback(() => {
    setThingtime('settings.showCommander', false)
    setValue('')
    setShowContext(false)
    setContextPath(undefined)
  }, [setThingtime, setShowContext])

  const toggleCommander = React.useCallback(() => {
    if (thingtime?.settings?.showCommander) {
      closeCommander()
    } else {
      openCommander()
    }
  }, [thingtime?.settings?.showCommander, closeCommander, openCommander])

  React.useEffect(() => {
    const keyListener = (e: any) => {
      if (e?.metaKey && e?.code === 'KeyP') {
        e.preventDefault()
        e.stopPropagation()
        toggleCommander()
      }
      // if key escape close all modals
      console.log('commander key listener e?.code', e?.code)
      if (e?.code === 'Escape') {
        closeCommander()
      }
    }

    window.addEventListener('keydown', keyListener)

    return () => {
      window.removeEventListener('keydown', keyListener)
    }
  }, [setThingtime, thingtime, toggleCommander, closeCommander])

  const selectSuggestion = React.useCallback(
    suggestion => {
      setValue(suggestion)
      setContextPath(suggestion)
      setShowContext(true, 'Select suggestion')
    },
    [setValue, setContextPath, setShowContext]
  )

  const excludedSuggestions = React.useMemo(() => {
    return ['.']
  }, [])

  const renderedSuggestions = React.useMemo(() => {
    return suggestions?.filter(suggestion => {
      return !excludedSuggestions?.includes(suggestion)
    })
  }, [suggestions, excludedSuggestions])

  const mobileVW = React.useMemo(() => {
    return 'calc(100vw - 45px)'
  }, [])

  return (
    <ClickAwayListener onClickAway={closeCommander}>
      <Flex
        id='commander'
        // display={['flex', showCommander ? 'flex' : 'none']}
        justifyContent={['flex-start', 'center']}
        // zIndex={99999}
        // position='fixed'
        // top='100px'
        pointerEvents={'none'}
        position='absolute'
        h='100%'
        top={0}
        left={0}
        right={0}
        py={1}
        px={1}
        maxW='100%'
      >
        <Flex
          alignItems={['flex-start', 'center']}
          position='absolute'
          top={'100%'}
          maxH='90vh'
          overflowY='scroll'
          left={0}
          right={0}
          h='auto'
          mt={2}
          mx={1}
          maxW='100%'
          borderRadius={'12px'}
          flexDir='column'
        >
          <Flex
            display={renderedSuggestions?.length ? 'flex' : 'none'}
            w={['100%', '400px']}
            maxW={'100%'}
            bg='grey'
            borderRadius={'12px'}
            flexDir='column'
            id='commander-suggestions'
            py={3}
            mb={3}
            pointerEvents={'all'}
          >
            {renderedSuggestions.map((suggestion, i) => {
              return (
                <Flex
                  cursor='pointer'
                  px={4}
                  _hover={{
                    bg: 'greys.medium'
                  }}
                  key={i}
                  onClick={() => selectSuggestion(suggestion)}
                >
                  {suggestion}
                </Flex>
              )
            })}
          </Flex>
          <Flex
            display={showContext ? 'flex' : 'none'}
            maxW='100%'
            py={3}
            borderRadius={'12px'}
            bg='grey'
            pointerEvents={'all'}
          >
            <Thingtime thing={contextValue}></Thingtime>
          </Flex>
        </Flex>
        <Center
          position='relative'
          bg='grey'
          w={['100%', '400px']}
          maxW={[mobileVW, '100%']}
          h='100%'
          outline={'none'}
          overflow='hidden'
          p={'1px'}
          borderRadius={'6px'}
          pointerEvents={'all'}
        >
          <Box
            position='absolute'
            width='105%'
            pb={'105%'}
            bg={
              'conic-gradient(#f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a)'
            }
            sx={{
              '@keyframes rainbow-conical': {
                '100%': {
                  transform: 'rotate(-360deg)'
                }
              },
              animation: 'rainbow-conical 1s linear infinite'
            }}
          ></Box>
          <Input
            ref={inputRef}
            h='100%'
            borderRadius={'5px'}
            outline={'none'}
            border={'none'}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            w='100%'
            sx={{
              '&::placeholder': {
                color: 'greys.dark'
              }
            }}
            placeholder={"What's on your mind?"}
          ></Input>
        </Center>
      </Flex>
    </ClickAwayListener>
  )
}
