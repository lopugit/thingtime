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
    if (["rainbow"]?.includes(name)) {
      return "🌈"
    }
    if (["sun"]?.includes(name)) {
      return "☀️"
    }
    if (["moon"]?.includes(name)) {
      return "🌙"
    }
    if (["unicorn"]?.includes(name)) {
      return "🦄"
    }
    if (["user", "person"]?.includes(name)) {
      return "👤"
    }
    if (["group", "team"]?.includes(name)) {
      return "👥"
    }
    if (["success", "check"]?.includes(name)) {
      return "✅"
    }
    if (["error", "stop"]?.includes(name)) {
      return "❌"
    }
    if (["warning", "alert"]?.includes(name)) {
      return "⚠️"
    }
    if (["time", "clock"]?.includes(name)) {
      return "⏰"
    }
    if (["star", "favorite"]?.includes(name)) {
      return "⭐"
    }
    if (["question", "help"]?.includes(name)) {
      return "❓"
    }
    if (["video", "media"]?.includes(name)) {
      return "🎥"
    }
    if (["music", "audio"]?.includes(name)) {
      return "🎵"
    }
    if (["image", "picture"]?.includes(name)) {
      return "🖼️"
    }
    if (["email", "mail"]?.includes(name)) {
      return "✉️"
    }
    if (["computer", "laptop"]?.includes(name)) {
      return "💻"
    }
    if (["mobile", "phone"]?.includes(name)) {
      return "📱"
    }
    if (["world", "globe"]?.includes(name)) {
      return "🌍"
    }
    if (["rocket", "launch"]?.includes(name)) {
      return "🚀"
    }
    if (["pencil", "edit"]?.includes(name)) {
      return "✏️"
    }
    if (["search", "magnify"]?.includes(name)) {
      return "🔍"
    }
    if (["lock", "secure"]?.includes(name)) {
      return "🔒"
    }
    if (["unlock", "access"]?.includes(name)) {
      return "🔓"
    }
    if (["thumb-up", "like"]?.includes(name)) {
      return "👍"
    }
    if (["thumb-down", "dislike"]?.includes(name)) {
      return "👎"
    }
  }, [name])

  return (
    <Center {...props?.chakras} fontSize={props?.size}>
      {icon}
    </Center>
  )
}
