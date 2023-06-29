import React from 'react'
import { Flex } from '@chakra-ui/react'
import { RainbowSkeleton } from '../Skeleton/RainbowSkeleton'
import { ProfileDrawer } from './ProfileDrawer'

export const Nav = props => {
  const [profileDrawerOpen, setProfileDrawerOpen] = React.useState(false)

  const toggleProfileDrawer = React.useCallback(() => {
    setProfileDrawerOpen(!profileDrawerOpen)
  }, [profileDrawerOpen])

  return (
    <>
      <Flex
        as='nav'
        w='100%'
        alignItems={'center'}
        justifyContent='center'
        flexDir={'row'}
        position='fixed'
        top={0}
        left={0}
        right={0}
        py={6}
        px={6}
        bg='white'
        zIndex={999}
        boxShadow={'0px 0px 10px rgba(0,0,0,0.1)'}
      >
        <RainbowSkeleton
          ml={'auto'}
          w='25px'
          h='25px'
          onClick={toggleProfileDrawer}
          sx={{}}
          borderRadius='999px'
        ></RainbowSkeleton>
        {/* <RainbowSkeleton w='40px' ml='auto' mr={"4px"}></RainbowSkeleton>
        <RainbowSkeleton></RainbowSkeleton> */}
      </Flex>
      {/* <ProfileDrawer isOpen={profileDrawerOpen}></ProfileDrawer> */}
    </>
  )
}
