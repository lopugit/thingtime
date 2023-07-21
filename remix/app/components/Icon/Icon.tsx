import React from "react"
import { Center } from "@chakra-ui/react"

export const Icon = (props) => {
  const name = props?.name

  const icon = React.useMemo(() => {
    // nothing
    if (["gear", "cog"]?.includes(name)) {
      return "⚙️"
    }
    if (["crystal"]?.includes(name)) {
      return "🔮"
    }
    if (["sparke", "magic"]?.includes(name)) {
      return "✨"
    }
    if (["box", "thing", "object"]?.includes(name)) {
      return "📦"
    }
    if (["book", "books"]?.includes(name)) {
      return "📚"
    }
    if (["book-open", "books-open"]?.includes(name)) {
      return "📖"
    }
    if (["book-reader", "books-reader"]?.includes(name)) {
      return "👩‍🏫"
    }
    if (["number", "hundred"]?.includes(name)) {
      return "💯"
    }
    if (["heart"]?.includes(name)) {
      return "❤️"
    }
    if (["heart-broken"]?.includes(name)) {
      return "💔"
    }
    if (["heart-pulse"]?.includes(name)) {
      return "💗"
    }
    if (["string", "text"]?.includes(name)) {
      return "💬"
    }
    if (["array", "list"]?.includes(name)) {
      return "📚"
    }
    if (["boolean", "bool"]?.includes(name)) {
      return "🌗"
      // return "⚖️"
    }
  }, [name])

  return (
    <Center {...props?.chakras} fontSize={props?.size}>
      {icon}
    </Center>
  )
}
