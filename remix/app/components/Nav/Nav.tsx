import React from 'react'
import { Box, Flex } from '@chakra-ui/react'
import { RainbowSkeleton } from '../Skeleton/RainbowSkeleton'
import { ProfileDrawer } from './ProfileDrawer'
import { Commander } from '../Commander/Commander'

export const Nav = props => {
  const [profileDrawerOpen, setProfileDrawerOpen] = React.useState(false)

  const toggleProfileDrawer = React.useCallback(() => {
    setProfileDrawerOpen(!profileDrawerOpen)
  }, [profileDrawerOpen])

  return (
    <>
      <Box position='fixed' top={0} left={0} right={0} zIndex={999}>
        <Flex
          as='nav'
          w='100%'
          alignItems={'center'}
          position='relative'
          justifyContent='center'
          flexDir={'row'}
          py={2}
          px={2}
          bg='white'
          boxShadow={'0px 0px 10px rgba(0,0,0,0.1)'}
        >
          <Commander></Commander>
          <RainbowSkeleton
            ml={'auto'}
            w='25px'
            h='25px'
            onClick={toggleProfileDrawer}
            bg={'rgba(0,0,0,0.1)'}
            sx={{}}
            borderRadius='999px'
          ></RainbowSkeleton>
          {/* <RainbowSkeleton w='40px' ml='auto' mr={"4px"}></RainbowSkeleton>
          <RainbowSkeleton></RainbowSkeleton> */}
        </Flex>
      </Box>
      {/* <ProfileDrawer isOpen={profileDrawerOpen}></ProfileDrawer> */}
    </>
  )
}
