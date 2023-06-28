import React from 'react'
import { Flex } from '@chakra-ui/react'

export const Attention = props => {
  return (
    <Flex
      {...props}
      flexDirection={'column'}
      justifyContent={'center'}
      alignItems={'center'}
      cursor={'pointer'}
    >
      <Flex
        w={props.w || '40px'}
        mb='10px'
        h='2px'
        bg='linear-gradient(to right, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a);'
        backgroundSize='200%'
        borderBottomRadius={'20px'}
        transition='all 0.5s ease-in-out'
        sx={{
          '@keyframes moving-rainbow': {
            '0%': { backgroundPosition: '0 0' },
            '100%': { backgroundPosition: '200% 0' }
          },
          // add delay
          animation: `moving-rainbow 3s infinite linear`
        }}
      ></Flex>
    </Flex>
  )
}
