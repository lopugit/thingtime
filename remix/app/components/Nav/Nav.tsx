import React from 'react'
import { Flex } from '@chakra-ui/react'
import { RainbowSkeleton } from '../Skeleton/RainbowSkeleton'

export const Nav = props => {
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
        py={4}
        px={4}
      >
        <RainbowSkeleton w='40px' ml='auto' mr={"4px"}></RainbowSkeleton>
        <RainbowSkeleton></RainbowSkeleton>
      </Flex>
    </>
  )
}
