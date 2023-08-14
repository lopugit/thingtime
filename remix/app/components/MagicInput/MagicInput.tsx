import React from "react"
import { Box } from "@chakra-ui/react"

import { useThingtime } from "../Thingtime/useThingtime"

export const MagicInput = (props) => {
  const { thingtime, setThingtime, loading } = useThingtime()

  const [inputValue, setInputValue] = React.useState()

  const contentEditableRef = React.useRef(null)
  const editValueRef = React.useRef({})

  const fullPath = React.useMemo(() => {
    const ret = props?.fullPath || props?.path

    // store this thing in the global db
    try {
      // window.meta.things[ret] = props?.value
    } catch {
      // nothing
    }

    return ret
  }, [props?.fullPath, props?.path, props?.value])

  const [contentEditableValue, setContentEditableValue] = React.useState(
    props?.value || props?.placeholder
  )

  const updateContentEditableValue = React.useCallback((value) => {
    // replace all new line occurences in value with <div><br></div>

    console.log("MagicInput updating contentEditableValue with value", value)

    // extract all series of new lines
    const newlines = value?.split?.(/[^\n]/)?.filter((v) => v !== "")

    let newValue = value

    // replace all new lines groups with <div><br></div>
    newlines?.forEach?.((newline) => {
      const baseLength = "\n"?.length

      const newlineClone = newline

      const newlineClonePart1 = newlineClone?.replace(
        "\n\n\n",
        "<div><br /></div>"
      )
      const newlineClonePart2 = newlineClonePart1?.replace(
        /\n\n/g,
        "<div><br /></div>"
      )
      const newlineClonePart3 = newlineClonePart2?.replace(/\n/g, "<br />")

      newValue = newValue?.replace(newline, newlineClonePart3)
    })

    setContentEditableValue(newValue)
  }, [])

  React.useEffect(() => {
    setInputValue(contentEditableValue)
  }, [contentEditableValue])

  React.useEffect(() => {
    const entries = Object.entries(editValueRef.current)
    const propsValueInEntries = entries?.find?.(
      (entry) => entry[1] === props?.value
    )
    if (!propsValueInEntries) {
      // const valueToUse = props?.value || props?.placeholder
      const valueToUse = props?.value
      updateContentEditableValue(valueToUse)
      // setContentEditableValue(props?.value)
    } else {
      const [time, value] = propsValueInEntries
      if (time && value) {
        delete editValueRef.current[time]
      }
    }
  }, [props?.value, props?.placeholder, updateContentEditableValue])

  const onValueChange = React.useCallback(
    (args) => {
      const { value } = args
      props?.onValueChange?.({ value })
      // updateContentEditableValue(value)
    },
    [props?.onValueChange]
  )

  const updateValue = React.useCallback(
    (args) => {
      const { value } = args

      onValueChange({ value })
      setInputValue(value)
      // setThingtime(fullPath, value)
    },
    [fullPath, setThingtime, onValueChange]
  )

  const onFocus = React.useCallback(
    (e) => {
      props?.onFocus?.(e)
    },
    [props?.onFocus]
  )

  const dangerouslySetInnerHTML = React.useMemo(() => {
    if (!props?.readonly) {
      return { __html: contentEditableValue }
    }
    // return { __html: contentEditableValue }
  }, [contentEditableValue, props?.readonly])
  return (
    <Box
      position="relative"
      width="100%"
      transition={props?.transition}
      {...(props?.chakras || {})}
    >
      <Box
        ref={contentEditableRef}
        width="100%"
        border="none"
        outline="none"
        contentEditable={!props?.readonly ? true : false}
        dangerouslySetInnerHTML={dangerouslySetInnerHTML}
        onFocus={onFocus}
        onInput={(value) => {
          const innerText = value?.target?.innerText
          console.log("MagicInput got onInput event value", value)
          console.log("MagicInput got onInput event innerText", innerText)
          if (typeof innerText === "string") {
            const time = Date.now()
            editValueRef.current[time] = innerText
            updateValue({ value: innerText })
          }
        }}
      >
        {props?.readonly ? props?.value : null}
      </Box>
      <Box
        position="absolute"
        top={0}
        left={0}
        display={inputValue ? "none" : "block"}
        width="100%"
        maxWidth="100%"
        color="greys.dark"
        pointerEvents="none"
      >
        {props?.placeholder || "Imagine.."}
      </Box>
    </Box>
  )
}
