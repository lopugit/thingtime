import { useContext } from "react"

import { ThingtimeContext } from "~/Providers/ThingtimeProvider"

const getGlobal = () => {
  try {
    return window
  } catch {
    return globalThis
  }
}

export const useThingtime = (props?: any) => {
  const value = useContext(ThingtimeContext)

  // const { thingtime, setThingtime, getThingtime, thingtimeRef } = value

  return value
}
