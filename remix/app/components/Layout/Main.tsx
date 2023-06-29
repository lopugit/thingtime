import { Flex } from '@chakra-ui/react'
import { Nav } from '../Nav/Nav'
import { ProfileDrawer } from '../Nav/ProfileDrawer'

export const Main = props => {
  return (
    <Flex
      position={'relative'}
      alignItems='center'
      justifyContent='center'
      flexDir={'column'}
      overflow='hidden'
      maxW='100vw'
    >
      {/* <ProfileDrawer></ProfileDrawer> */}
      <Nav />
      {props.children}
    </Flex>
  )
}
