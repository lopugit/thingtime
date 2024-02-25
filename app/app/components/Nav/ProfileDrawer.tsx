import React from 'react'
import { Drawer, DrawerBody, DrawerContent, Flex } from '@chakra-ui/react'

export const ProfileDrawer = props => {
  const navItems = ['settings']

  const onClose = React.useCallback(() => {
    // nothing
  }, [])

  return (
    <Drawer
      placement='right'
      size='md'
      isOpen={props?.isOpen}
      onClose={onClose}
    >
      <DrawerContent maxW={'90%'} mt={'35px'} className='ProfileDrawer'>
        <DrawerBody>
          {navItems.map((item, idx) => {
            return <Flex key={idx}>{item}</Flex>
          })}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}
