import React from "react"

export const useUuid = () => {
  const [uuid, setUuid] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    setUuid(globalThis.crypto.randomUUID())
  }, [])

  return uuid
}
