import React from 'react'
import { Box, Flex } from '@chakra-ui/react'

export const Thingtime = props => {
  const thing = React.useMemo(() => {
    return props.thing
  }, [props.thing])

  const mode = React.useMemo(() => {
    return 'view'
  }, [])

  const validKeyTypes = React.useMemo(() => {
    return ['object', 'array']
  }, [])

  const keys = React.useMemo(() => {
    if (validKeyTypes?.includes(typeof thing)) {
      return Object.keys(thing)
    } else {
      return []
    }
  }, [thing, validKeyTypes])

  React.useEffect(() => {
    if (window?.thingtime?.things) {
      window.thingtime.things.count =
        (window?.thingtime?.things?.count || 1) + 1
    }
  }, [])

  const type = React.useMemo(() => {
    return typeof thing
  }, [thing])

  const renderableValue = React.useMemo(() => {
    if (type === 'string') {
      return thing
    } else if (type === 'number') {
      return thing
    } else if (type === 'boolean') {
      return thing ? 'true' : 'false'
    } else if (type === 'object') {
      return JSON.stringify(thing, null, 2)
    } else {
      return null
    }
  }, [thing, type])

  const flattenedKeys = React.useMemo(() => {
    // create an array of all keys on object so that if object is
    // { my: { child: {} } }
    // the array looks like
    // ['my', 'my.child']

    const ret = []

    try {
      const randId = Math.random().toString(36).substring(7)

      window.thingtime.tmp[randId] = 0

      const recurse = (obj, prefix) => {
        Object.keys(obj).forEach(key => {
          if (typeof obj[key] === 'object') {
            if (window?.thingtime?.tmp[randId] < 1000) {
              window.thingtime.tmp[randId]++
              recurse(obj[key], `${prefix}${prefix && '.'}${key}`)
            } else {
              console.error('Recursion limit reached in Thingtime.tsx')
            }
          } else {
            ret.push({
              key: `${prefix}${prefix && '.'}${key}`,
              human: `${prefix}${prefix && ' '}${key}`
            })
          }
        })
      }

      console.log('nik ret 1', thing)

      recurse(thing, '')
    } catch (err) {
      // console.error('Error in Thingtime.tsx creating flattenedKeys', err)
    }

    console.log('nik ret 2', ret)

    return ret
  }, [thing])

  // do not render more than the limit of things to prevent infinite loops
  try {
    if (
      typeof window?.thingtime?.things?.count === 'number' &&
      window?.thingtime?.things?.count > window?.thingtime?.things?.limit
    ) {
      console.error('Maximum things reached')
      return null
    }
  } catch (err) {
    // console.error('Error in Thingtime.tsx checking maximum things', err)
  }

  let ret = null

  const keysToUse = keys
  // const keysToUse = flattenedKeys

  const template1Modes = ['view', 'edit']

  if (template1Modes?.includes(mode)) {
    console.log('nik keys', keys)
    if (keys?.length) {
      ret = (
        <Flex
          position='relative'
          flexDir='column'
          minW='500px'
          maxW='100%'
          pl={6}
        >
          {keysToUse?.length &&
            keysToUse.map((key, idx) => {
              if (!key?.human) {
                key = {
                  human: key,
                  key: key
                }
              }

              const nextThing = thing[key?.key]

              return (
                <Thingtime
                  key={idx}
                  parent={thing}
                  path={key}
                  thing={nextThing}
                ></Thingtime>
              )
            })}
        </Flex>
      )
    } else {
      ret = (
        <Flex flexDir='column'>
          <Box>{props?.key?.human}</Box>
          <Box
            contentEditable={mode === 'edit'}
            border='none'
            outline={'none'}
            py={2}
            fontSize={'20px'}
          >
            {renderableValue}
          </Box>
        </Flex>
      )
    }
  }

  const contextMenu = (
    <Flex position='absolute' top={0} right={0}>
      Settings
    </Flex>
  )

  const [showContextMenu, setShowContextMenu] = React.useState(false)

  return (
    <Flex
      onMouseEnter={() => setShowContextMenu(true)}
      onMouseLeave={() => setShowContextMenu(false)}
      position='relative'
      {...props}
    >
      {showContextMenu && contextMenu}
      {ret}
    </Flex>
  )
}
