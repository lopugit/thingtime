import { Text } from '@chakra-ui/react'
import React from 'react'

export const RainbowText = props => {
  return (
    <Text
      as='h1'
      userSelect={'none'}
      position='relative'
      fontSize='6xl'
      fontWeight='bold'
      backgroundClip={'text'}
      color='transparent'
      bgGradient='linear-gradient(to right, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a)'
      backgroundSize='200%'
      sx={{
        '@keyframes moving-rainbow': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '200% 0' }
        },
        animation: 'moving-rainbow 5s infinite linear'
      }}
    >
      {props?.children}
    </Text>
  )
}
