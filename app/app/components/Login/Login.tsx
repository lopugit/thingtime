import React, { useState } from "react"
import { Flex, FormControl, Input } from "@chakra-ui/react"

export const Login = (props) => {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleLogin = () => {
    // handle login
  }

  return (
    <>
      <Flex flexDirection="column" gap={4} width="auto">
        <FormControl>
          <Input
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            value={email}
          />
        </FormControl>

        <FormControl>
          <Input
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            type="password"
            value={password}
          />
        </FormControl>

        <Flex
          width="100%"
          color="white"
          background="chakras.violet"
          borderRadius={6}
          cursor="pointer"
          paddingX={5}
          paddingY={2}
        >
          Login
        </Flex>
      </Flex>
    </>
  )
}
