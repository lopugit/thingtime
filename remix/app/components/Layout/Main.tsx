import { Flex } from '@chakra-ui/react'
import { Nav } from '../Nav/Nav'

export const Main = props => {
  return (
    <Flex alignItems='center' justifyContent='center' flexDir={'column'}>
      <Nav />
      {props.children}
    </Flex>
  )
}
