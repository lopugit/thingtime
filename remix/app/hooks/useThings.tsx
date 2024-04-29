import React from "react"

export const useThings = (props?: any) => {
  const append = React.useCallback((args) => {
    const { thing, value } = args

    if (thing instanceof Array) {
      const newValue = [...thing, value]
      return newValue
    }

    if (typeof thing === "object") {
      const newChildBasePath = "New Value"
      // find increment that thing doesn't already have New Value N+1
      let increment = 0
      let newPath = newChildBasePath
      while (Object.hasOwnProperty.call(thing, newPath) && increment <= 999) {
        increment++
        newPath = newChildBasePath + " " + increment
      }
      const newChildPath = newPath

      const newValue = { ...thing }
      newValue[newChildPath] = value
      return newValue
    }
  }, [])

  const ret = {
    append,
  }

  return ret
}
