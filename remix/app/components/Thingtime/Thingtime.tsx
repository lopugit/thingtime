import React from 'react'
import { Box, Flex } from '@chakra-ui/react'
import { Safe } from '../Safety/Safe'
import { useThingtime } from './useThingtime'

export const Thingtime = props => {
  // const uuid = React.useMemo(() => {
  //   return Math.random().toString(36).substring(7)
  // }, [])

  const [uuid, setUuid] = React.useState()

  const pl = React.useMemo(() => {
    return props?.pl || [4, 6]
  }, [props?.pl])

  // will only run on the client
  React.useEffect(() => {
    setUuid(Math.random().toString(36).substring(7))
  }, [])

  const { thingtime } = useThingtime()

  const depth = React.useMemo(() => {
    return props?.depth || 1
  }, [props?.depth])

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
      const keysRet = Object.keys(thing)
      return keysRet
    } else {
      return []
    }
  }, [thing, validKeyTypes])

  const type = React.useMemo(() => {
    return typeof thing
  }, [thing])

  const renderableValue = React.useMemo(() => {
    if (type === 'string') {
      if (!thing) {
        return 'Empty string'
      }
      return thing
    } else if (type === 'number') {
      return thing
    } else if (type === 'boolean') {
      return thing ? 'true' : 'false'
    } else if (type === 'object') {
      if (thing === null) {
        return 'null'
      }
      if (!keys?.length) {
        return 'Empty object'
      }

      try {
        return JSON.stringify(thing, null, 2)
      } catch (err) {
        console.error(
          'Caught error making renderableValue of thing',
          err,
          thing
        )
        return 'Circular reference in object.'
      }
    } else {
      return 'Undefined'
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

      recurse(thing, '')
    } catch (err) {
      // console.error('Error in Thingtime.tsx creating flattenedKeys', err)
    }

    return ret
  }, [thing])

  let value = null
  let editableValue = null

  const keysToUse = keys
  // const keysToUse = flattenedKeys

  const template1Modes = ['view', 'edit']

  if (template1Modes?.includes(mode)) {
    if (keys?.length) {
      value = (
        <Safe {...props}>
          <Flex
            position='relative'
            flexDir='column'
            // w={'500px'}
            // w={['200px', '500px']}
            maxW='100%'
            py={props?.path ? 3 : 0}
            pl={props?.valuePl}
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
    } else {
      editableValue = (
        <Box
          contentEditable={mode === 'edit'}
          border='none'
          outline={'none'}
          py={2}
          pl={pl}
          fontSize={'20px'}
        >
          {renderableValue}
        </Box>
      )
    }
  }

  const contextMenu = (
    <Flex pr={4} userSelect={'none'} position='absolute' top={0} right={0}>
      Settings
    </Flex>
  )

  const [showContextMenu, setShowContextMenu] = React.useState(false)

  const path = React.useMemo(() => {
    return (
      <Flex maxW='100%' pl={pl} wordBreak={'break-all'} fontSize='12px'>
        {props?.path?.human}
      </Flex>
    )
  }, [props?.path])

  const handleMouseEvent = React.useCallback(
    e => {
      const target = e?.target
      // extract uuid from className
      const className = target?.className
      if (className?.includes(uuid?.current)) {
        setShowContextMenu(e?.type === 'mouseenter')
      }
    },
    [uuid]
  )

  return (
    <Safe {...props} depth={depth} uuid={uuid?.current}>
      <Flex
        onMouseEnter={handleMouseEvent}
        onMouseLeave={handleMouseEvent}
        position='relative'
        flexDir='column'
        py={3}
        w='500px'
        // minW={depth === 1 ? '120px' : null}
        maxW='100%'
        {...props}
        className={`thing-${uuid?.current}`}
      >
        {/* {uuid?.current} */}
        {path}
        {/* {showContextMenu && contextMenu} */}
        {editableValue}
        {value}
      </Flex>
    </Safe>
  )
}
