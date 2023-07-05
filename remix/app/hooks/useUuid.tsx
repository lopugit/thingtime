import React from "react"

export const useUuid = () => {
  const [uuid, setUuid] = React.useState()

  React.useEffect(() => {
    setUuid(Math.random().toString(36).substring(7))
  }, [])

  return uuid
}
