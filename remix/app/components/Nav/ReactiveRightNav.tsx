import React from 'react'
import { Center, Text } from '@chakra-ui/react'

export const ReactiveRightNav = props => {
  const setNav = React.useCallback(active => {
    setMr(active ? '0%' : '-100%')
    setNavActive(active)
  }, [])

  const [entered, setEntered] = React.useState(false)

  React.useEffect(() => {
    // react to mouse move event
    const listener = event => {
      const windowWidth = window.innerWidth
      if (!entered) {
        if (event?.clientX >= windowWidth - 60) {
          setNav(true)
        } else if (event?.clientX <= windowWidth - 100) {
          setNav(false)
        }
      }
    }
    window.addEventListener('mousemove', listener)
    return () => {
      window.removeEventListener('mousemove', listener)
    }
  }, [setNav, entered])

  const [navActive, setNavActive] = React.useState(false)

  // const defaultMr = '-100%'
  const defaultMr = '0%'

  const [mr, setMr] = React.useState(defaultMr)

  const navItems = React.useMemo(() => {
    return ['home', 'imagine', 'create', 'share']
  }, [])

  return (
    <Center
      mr={mr}
      transition={'all 0.3s ease-in-out'}
      position='fixed'
      top={0}
      right={0}
      h='100%'
      flexDir='column'
    >
      <Center
        onMouseEnter={() => setEntered(true)}
        onMouseLeave={() => setEntered(false)}
        flexDir={'column'}
        borderLeftRadius={'40px'}
        h='85%'
        minW={'600px'}
        maxW='100%'
        py={80}
        px={100}
        bg={`rgba(0, 0, 0, 0.01)`}
      >
        {navItems.map((navItem, idx) => {
          return (
            <Text
              color='black'
              my={'auto'}
              fontWeight='semibold'
              key={idx}
              textTransform={'capitalize'}
              as='h2'
              cursor='pointer'
              fontSize='30px'
            >
              {navItem}
            </Text>
          )
        })}
      </Center>
    </Center>
  )
}
