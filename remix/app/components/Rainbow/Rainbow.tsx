import React from "react"
import { Box } from "@chakra-ui/react"

export const Rainbow = (props: any): JSX.Element => {
  const rainbow = ["#f34a4a", "#ffbc48", "#58ca70", "#47b5e6", "#a555e8"]

  const [colors, setColors] = React.useState(props?.colors || rainbow)

  return (
    <Box width={20} height={20} background="green">
      {props?.children}
    </Box>
  )
}
