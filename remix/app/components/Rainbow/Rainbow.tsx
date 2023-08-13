import React from "react"
import { Box, Center } from "@chakra-ui/react"

import { GradientPath } from "~/gp/GradientPath"
import { useProps } from "~/hooks/useProps"
import { useTrace } from "~/hooks/useTrace"
import { useUuid } from "~/hooks/useUuid"

export const Rainbow = (allProps: any): JSX.Element => {
  // return allProps.children

  const rainbow = ["#f34a4a", "#ffbc48", "#58ca70", "#47b5e6", "#a555e8"]

  const props = useProps(allProps)

  const uuid = useUuid()

  props.expand = props?.expand || true

  const [hidden, setHidden] = React.useState(true)
  const repeats = props?.repeats || 1
  const [filter, setFilter] = React.useState(props?.filter)
  const opacity = props?.opacity !== undefined ? props?.opacity : 1
  const [colors, setColors] = React.useState(props?.colors || rainbow)
  const [pathWidth, setPathWidth] = React.useState(props?.thickness || 1)
  const [overflow, setOverflow] = React.useState(props?.overflow || "hidden")
  const [opacityTransition, setOpacityTransition] = React.useState(
    props?.opacityTransition || "all 10000ms ease"
  )

  const parentRef = React.useRef(null)

  const repeatedColours = React.useMemo(() => {
    const ret = []

    for (let i = 0; i < repeats; i++) {
      ret.push(...colors)
    }

    ret.push(colors[0])

    return ret
  }, [colors, repeats])

  // make SVG that takes makes path in the shape of a box
  // which adjusts to the parent containers size

  const [state, setState] = React.useState({
    width: 100,
    height: 100,
  })

  const [strokeWidth, setStrokeWidth] = React.useState(1)

  const [extraStroke, setExtraStroke] = React.useState(0)

  const [width, setWidth] = React.useState(props?.width || "100%")
  const [height, setHeight] = React.useState(props?.height || "100%")

  const pathString = React.useMemo(() => {
    const startPoint = 0 + strokeWidth / 2
    const endPoint = 100 - strokeWidth / 2

    return `M -${4} ${startPoint} H ${endPoint} V ${endPoint} H ${startPoint} V ${startPoint}`
  }, [strokeWidth])

  const svgRef = React.useRef(null)

  const colourKeyframes = React.useMemo(() => {
    const ret = {}

    repeatedColours.map((colour, i) => {
      const keyframe = `${(i / (repeatedColours.length - 1)) * 100}%`
      ret[keyframe] = {
        fill: colour,
        animationTimingFunction: "ease-out",
        stroke: colour,
      }
    })

    return ret
  }, [repeatedColours])

  React.useEffect(() => {
    const updateChildSize = () => {
      const { width, height } =
        parentRef?.current?.getBoundingClientRect() || {}
      setState({ width, height })
    }

    updateChildSize()

    new ResizeObserver(updateChildSize).observe(parentRef?.current)
  }, [])

  const rect = React.useMemo(() => {
    return (
      <rect
        // stroke="url(#linear-gradient)"
        x={0}
        y={0}
        width={state?.width || 100}
        height={state?.height || 100}
        rx={10}
        ry={10}
      ></rect>
    )
  }, [state?.width, state?.height])

  const svg = React.useMemo(() => {
    return (
      <Box width="100%" height="100%" id={"rainbow-svg-container-" + uuid}>
        <svg
          overflow="visible"
          viewBox={`0 0 ${state?.width || 100} ${state?.height || 100}`}
          width="100%"
          height="100%"
          preserveAspectRatio="none"
        >
          {rect}
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
  }, [state, rect, uuid])

  React.useEffect(() => {
    if (uuid) {
      const svg = svgRef?.current?.querySelector("svg")

      // path is rect or insert new rect if empty svg
      const rectSource = parentRef?.current?.querySelector(".svg-source rect")
      const path =
        svg?.querySelector?.("rect") ||
        svg?.appendChild?.(rectSource?.cloneNode?.())

      if (path) {
        const gp = new GradientPath({
          path,
          segments: props?.segments || 1000,
          samples: props?.samples || 1,
          precision: props?.precision || 5,
        })

        gp.render({
          type: "path",
          width: pathWidth || 1,
          animation: {
            name: `rainbow-${uuid}`,
            duration: props?.duration || 7,
          },
        })

        setTimeout(() => {
          setHidden(false)
        }, 500)

        return () => {
          // setHidden(true)
          gp.remove()
        }
      }
    }
  }, [
    uuid,
    props?.duration,
    props?.segments,
    props?.samples,
    props?.precision,
    pathWidth,
    repeatedColours,
    parentRef,
    svgRef,
    rect,
  ])

  const render = true

  // useTrace("Rainbow", {
  //   props,
  // })

  return (
    <>
      <Center
        className="Rainbow_n__n"
        ref={parentRef}
        sx={{
          [`@keyframes rainbow-${uuid}`]: {
            ...colourKeyframes,
          },
        }}
        position={props?.position || "relative"}
        overflow={overflow}
        width={props?.expand ? "100%" : ""}
        height={props?.expand ? "100%" : ""}
      >
        <Center
          className="main-svg-container"
          position="absolute"
          top={0}
          left={0}
          overflow="visible"
          width="100%"
          height="100%"
          opacity={hidden ? "0" : opacity}
          // pointerEvents="none"
          transition={opacityTransition}
        >
          {/* debug svg */}
          <Box
            className="svg-source"
            flexShrink={0}
            display="none"
            overflow="visible"
            width={width}
            height={height}
          >
            {svg}
          </Box>
          <Box
            ref={svgRef}
            flexShrink={0}
            overflow="visible"
            width={width}
            height={height}
            opacity={hidden ? 0 : !render ? "0" : 1}
            filter={filter}
          >
            {svg}
          </Box>
        </Center>
        {allProps?.children}
      </Center>
    </>
  )
}
