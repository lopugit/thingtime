import React from "react"
import { Box, Center } from "@chakra-ui/react"
import { GradientPath } from "gradient-path"

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

  const svg = React.useMemo(() => {
    return (
      <Box
        sx={{
          "svg g:nth-child(2)": {
            display: "none",
          },
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
          preserveAspectRatio="none"
        >
          <rect x={0} y={0} width={100} height={100} rx={10} ry={10}></rect>
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
  }, [pathString, strokeWidth, extraStroke, viewBox])

  React.useEffect(() => {
    const path = svgRef.current.querySelector("rect")

    if (path) {
      const gp = new GradientPath({
        path,
        segments: props?.segments || 2000,
        samples: props?.samples || 10,
        precision: props?.precision || 10,
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
        fill: colors,
        strokeWidth: 1,
        stroke: colors,
      })

      let prevColours = colors

      const interval = setInterval(() => {
        // pop first colour and append new first colour to end
        const prevColoursClone = prevColours.map((colour) => {
          return {
            ...colour,
          }
        })
        const newColoursStart = prevColoursClone.slice(1)
        const newColours = [...newColoursStart, { ...newColoursStart[0] }]

        const adjustedPosition = newColours.map((colour, idx) => {
          return {
            ...colour,
            pos: idx / (newColours.length - 1),
          }
        })

        prevColours = adjustedPosition

        gp.render({
          type: "path",
          width: 10,
          fill: adjustedPosition,
          strokeWidth: 1,
          stroke: adjustedPosition,
        })
      }, 1000)

      return () => {
        clearInterval(interval)
      }
    }
  }, [])

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
