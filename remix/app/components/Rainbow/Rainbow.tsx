import React from "react"
import { Box, Center } from "@chakra-ui/react"

import { GradientPath } from "~/gp/GradientPath"

export const Rainbow = (props: any): JSX.Element => {
  const rainbow = ["#f34a4a", "#ffbc48", "#58ca70", "#47b5e6", "#a555e8"]

  const [colors, setColors] = React.useState(props?.colors || rainbow)

  const repeatedColours = React.useMemo(() => {
    return [...colors, colors[0]]
  }, [colors])

  // make SVG that takes makes path in the shape of a box
  // which adjusts to the parent containers size

  const [strokeWidth, setStrokeWidth] = React.useState(1)

  const [extraStroke, setExtraStroke] = React.useState(0)

  const [width, setWidth] = React.useState(props?.width || "105%")
  const [height, setHeight] = React.useState(props?.height || "105%")

  const pathString = React.useMemo(() => {
    const startPoint = 0 + strokeWidth / 2
    const endPoint = 100 - strokeWidth / 2

    return `M -${4} ${startPoint} H ${endPoint} V ${endPoint} H ${startPoint} V ${startPoint}`
  }, [strokeWidth])

  const viewBox = React.useMemo(() => {
    return `0 0 100 100`
  }, [])

  const svgRef = React.useRef(null)

  const colourKeyframes = React.useMemo(() => {
    const ret = {}

    repeatedColours.map((colour, i) => {
      const keyframe = `${(i / (repeatedColours.length - 1)) * 100}%`
      ret[keyframe] = {
        fill: colour,
        stroke: colour,
      }
    })

    return ret
  }, [repeatedColours])

  const colourClasses = React.useMemo(() => {
    const ret = {}

    const steps = 500

    repeatedColours.forEach((color, i) => {
      for (let j = 0; j < steps; j++) {
        const nth = `:nth-child(${repeatedColours?.length * j}n+${i + j})`
        ret[".path-segment" + nth] = {
          // animation: `rainbow-psych 2s linear infinite`,
          // "animation-delay": `-${(i + j) * 0.05}s`,
        }
      }
    })

    return ret
  }, [repeatedColours])

  const svg = React.useMemo(() => {
    return (
      <Box
        sx={{
          rainbowPsych: {
            rainbowPsych: "rainbowPsych",
          },
          "@keyframes rainbow-psych": {
            ...colourKeyframes,
          },
          ...colourClasses,
        }}
        width="100%"
        height="100%"
      >
        <svg
          ref={svgRef}
          overflow="visible"
          viewBox={viewBox}
          width="100%"
          height="100%"
          // preserveAspectRatio="none"
        >
          <rect
            // stroke="url(#linear-gradient)"
            x={0}
            y={0}
            width={100}
            height={100}
            rx={10}
            ry={10}
          ></rect>
          {/* <path
            fill="none"
            stroke="blue"
            strokeAlignment="inner"
            strokeWidth={`${strokeWidth + extraStroke}px`}
            d={pathString}
          ></path> */}
        </svg>
      </Box>
    )
  }, [
    pathString,
    strokeWidth,
    extraStroke,
    viewBox,
    repeatedColours,
    colors,
    colourKeyframes,
    colourClasses,
  ])

  React.useEffect(() => {
    const path = svgRef.current.querySelector("rect")

    if (path) {
      const gp = new GradientPath({
        path,
        segments: props?.segments || 250,
        samples: props?.samples || 5,
        precision: props?.precision || 5,
      })

      const colors = repeatedColours?.map((color, idx) => {
        return {
          color,
          pos: idx / (repeatedColours.length - 1),
        }
      })

      gp.render({
        type: "path",
        width: 10,
        fill: ["orange", "blue", "orange"],
        // fill: colors,
        strokeWidth: 0.5,
        stroke: ["orange", "blue", "orange"],
        // stroke: colors,
      })

      return () => {
        // clearInterval(interval)
      }
    }
  }, [props, repeatedColours])

  return (
    <Center
      position={props?.position || "relative"}
      overflow="visible"
      padding="25px"
      background="lightblue"
    >
      {props?.children}
      <Center
        position="absolute"
        top={0}
        left={0}
        overflow="visible"
        width="100%"
        height="100%"
      >
        <Box flexShrink={0} overflow="visible" width={width} height={height}>
          {svg}
        </Box>
      </Center>
    </Center>
  )
}
