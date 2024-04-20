import React from 'react';
import { Drawer, DrawerBody, DrawerContent, Flex } from '@chakra-ui/react';

export const ProfileDrawer = (props: any) => {
  const navItems = ['settings'];

  const onClose = React.useCallback(() => {
    // nothing
  }, []);

  return (
    <Drawer isOpen={props?.isOpen} onClose={onClose} placement="right" size="md">
      <DrawerContent className="ProfileDrawer" maxWidth="90%" marginTop="35px">
        <DrawerBody>
          {navItems.map((item, idx) => {
            return <Flex key={idx}>{item}</Flex>;
          })}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};
