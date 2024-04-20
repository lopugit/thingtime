import React from "react"

export const useProps = (allProps) => {
  const deps = Object.values(allProps).filter((v) => v !== allProps.children)

  return React.useMemo(() => {
    const { children, ...other } = allProps
    return other
  }, deps)
}
