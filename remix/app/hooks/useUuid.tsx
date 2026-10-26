import React from "react"

export const useUuid = () => {
  const [uuid, setUuid] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    setUuid(Math.random().toString(36).substring(7))
  }, [])

  return uuid
}
