import { extendTheme } from "@chakra-ui/react"

// import { breakpoints } from "./breakpoints"
// import { styles } from "./styles"
import { colors } from "./colors"
// import { fonts } from "./fonts"
// import { sizes } from "./sizes"
// import { Button, Divider, Heading, Input, Link, Select, Text, Checkbox, Textarea } from "./components"

const overrides = {
  // breakpoints,
  // styles,
  colors,
  // sizes,
  // fonts,
  // components: {
  //   Button,
  //   Heading,
  //   Text,
  //   Divider,
  //   Input,
  //   Link,
  //   Select,
  //   Checkbox,
  //   Textarea,
  // },
}

export default extendTheme(overrides)
