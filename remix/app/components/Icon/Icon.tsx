import React from "react"
import { Center } from "@chakra-ui/react"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"

export const Icon = (props) => {
  const icon = React.useMemo(() => {
    if (props?.name === "gear") {
      return {
        prefix: "fas",
        iconName: props?.name,
      }
    }

    return props?.name
  }, [props?.name])

  return (
    <Center {...props?.chakras}>
      <FontAwesomeIcon icon={icon}></FontAwesomeIcon>
    </Center>
  )
}
