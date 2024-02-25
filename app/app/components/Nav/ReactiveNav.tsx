import React from 'react'
import { Flex } from '@chakra-ui/react'
import { Hamburger } from '../Buttons/Hamburger'
import { Attention } from '../Buttons/Attention'
import { RightNav } from './ReactiveRightNav'

export const ReactiveNav = props => {
  const [navItems] = React.useState([{}])

  const setNav = React.useCallback(active => {
    setMt(active ? '100%' : '0%')
    setNavActive(active)
  }, [])

  React.useEffect(() => {
    // react to mouse move event
    const listener = event => {
      if (event?.clientY <= 20) {
        setNav(true)
      } else if (event?.clientY >= 100) {
        setNav(false)
      }
    }
    window.addEventListener('mousemove', listener)
    return () => {
      window.removeEventListener('mousemove', listener)
    }
  }, [setNav])

  const [navActive, setNavActive] = React.useState(false)

  const [mt, setMt] = React.useState('0%')

  return (
    <>
      <Flex
        as='nav'
        w='100%'
        alignItems={'center'}
        justifyContent='center'
        flexDir={'row'}
        position='fixed'
        py={'1%'}
        px={'1%'}
        bottom={'100%'}
        transform={`translateY(${mt})`}
        transition={'all 0.3s ease-in-out'}
        // top={'100%'}
        // top={0}
        left={0}
        right={0}
      >
        <Hamburger ml='auto'></Hamburger>
        <Flex
          opacity={navActive ? 0 : 1}
          position='absolute'
          transition={'all 0.2s ease-in-out'}
          top='100%'
          left={'50%'}
          translateX={'-50%'}
        >
          {/* w={navActive ? '0px' : '40px'} */}
          <Attention></Attention>
        </Flex>
      </Flex>
      <RightNav></RightNav>
    </>
  )
}
