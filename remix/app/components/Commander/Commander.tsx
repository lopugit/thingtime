import React from 'react'
import { Center, Box, Flex, Input } from '@chakra-ui/react'
import { useThingtime } from '../Thingtime/useThingtime'
import { Thingtime } from '../Thingtime/Thingtime'
import { sanitise } from '~/functions/path'

export const Commander = props => {
  const { thingtime, setThingtime, getThingtime } = useThingtime()

  const [contextPath, setContextPath] = React.useState()

  const [showContext, setShowContext] = React.useState(false)

  const contextValue = React.useMemo(() => {
    console.log('thingtime updated!')
    const ret = getThingtime(contextPath)
    console.log('nik ret', ret)
    return ret
  }, [contextPath, getThingtime])

  const showCommander = React.useMemo(() => {
    console.log(
      'nik thingtime?.settings?.showCommander',
      thingtime?.settings?.showCommander
    )
    return thingtime?.settings?.showCommander
  }, [thingtime?.settings?.showCommander])

  React.useEffect(() => {
    if (thingtime?.settings?.clearCommanderOnToggle) {
      setValue('')
    }
    if (showCommander) {
      inputRef?.current?.focus?.()
    }
  }, [showCommander, thingtime])

  const inputRef = React.useRef()

  const [value, setValue] = React.useState('')

  const onChange = React.useCallback(e => {
    setValue(e.target.value)
  }, [])

  const onEnter = React.useCallback(
    props => {
      // if first characters of value equal tt. then run command
      // or if first character is a dot then run command
      try {
        const isTT = value?.slice(0, 3) === 'tt.'
        const isDot = value?.slice(0, 1) === '.'
        const executeCommand = isTT || isDot
        if (executeCommand) {
          const command = isTT ? value?.slice(3) : value?.slice(1)
          const sanitisedCommand = sanitise(command)
          console.log('nik command', command)

          console.log('setting to thingtime', thingtime)

          const commandIsSetter = command?.includes('=')

          if (commandIsSetter) {
            // nothing
            const [pathRaw, valRaw] = sanitisedCommand?.split('=')
            const path = pathRaw.trim()
            const val = valRaw.trim()
            console.log('nik path', path)
            console.log('nik val', val)
            try {
              const realVal = eval(val)
              console.log('nik realVal', realVal)
              setThingtime(path, realVal)
            } catch (err) {
              console.log('setThingtime errored in Commander', err)
            }
            // setContextPath(path)
          } else {
            const val = getThingtime(sanitisedCommand)

            console.log('setting to val', val)

            setContextPath(sanitisedCommand)
            setShowContext(true)
          }
        }
      } catch (err) {
        console.error('Caught error on commander onEnter', err)
      }
    },
    [value, thingtime, getThingtime, setThingtime]
  )

  // trigger on enter
  const onKeyDown = React.useCallback(
    e => {
      if (e.key === 'Enter') {
        console.log('nik enter')
        e.preventDefault()
        e.stopPropagation()
        onEnter({ e })
        // setThingtime(
        //   'settings.showCommander',
        //   !thingtime?.settings?.showCommander
        // )
      }
    },
    [thingtime?.settings?.showCommander, onEnter]
  )

  const openCommander = React.useCallback(() => {
    setThingtime('settings.showCommander', true)
  }, [setThingtime])

  const closeCommander = React.useCallback(() => {
    setThingtime('settings.showCommander', false)
    setShowContext(false)
    setContextPath(undefined)
  }, [setThingtime])

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
        console.log('nik heard event')
        e.preventDefault()
        e.stopPropagation()
        toggleCommander()
      }
      // if key escape close all modals
      if (e?.code === 'Escape') {
        closeCommander()
      }
    }

    window.addEventListener('keydown', keyListener)

    return () => {
      window.removeEventListener('keydown', keyListener)
    }
  }, [setThingtime, thingtime])

  return (
    <Center
      id='commander'
      display={showCommander ? 'flex' : 'none'}
      // zIndex={99999}
      // position='fixed'
      // top='100px'
      position='absolute'
      h='100%'
      top={0}
      left={0}
      right={0}
      py={1}
    >
      <Center
        display={showContext ? 'flex' : 'none'}
        position='absolute'
        top={'100%'}
        left={0}
        right={0}
        h='auto'
        mt={2}
      >
        <Flex p={3} borderRadius={'12px'} bg='grey'>
          <Thingtime thing={contextValue}></Thingtime>
        </Flex>
      </Center>
      <Center
        position='relative'
        bg='grey'
        w='400px'
        h='100%'
        outline={'none'}
        overflow='hidden'
        p={'1px'}
        borderRadius={'6px'}
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
    </Center>
  )
}
