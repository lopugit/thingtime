import React from "react"

export const useTrace = (name, props) => {
  const prev = React.useRef(props)
  React.useEffect(() => {
    const changedProps = Object.entries(props).reduce(
      (changedValues, [key, newValue]) => {
        window.trace = window.trace || {}
        window.trace[key] = newValue
        if (prev.current[key] !== newValue) {
          changedValues[key] = {
            old: prev.current[key],
            new: newValue,
          }
        }
        return changedValues
      },
      {}
    )
    if (Object.keys(changedProps)?.length) {
      console.table({ TT: { name }, ...changedProps })
    }
    prev.current = props
  })
}
