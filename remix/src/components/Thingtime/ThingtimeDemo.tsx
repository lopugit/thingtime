import React from "react"
import { Flex } from "@chakra-ui/react"

import { Thingtime } from "./Thingtime"

export const ThingtimeDemo = (props) => {
  const thing = {
    Suggestion: "Press ctrl/cmd + P",
    Name: "thingtime",
    Description: `
      Thing Time is a versatile online platform that empowers users to organize, customize, and manage different types of data. 
      
      By generalizing the concept of social media feeds, Thing Time allows users to switch between various data schemas, essentially providing them with personalized feeds and organizational tools. 
      
      It's like a combination of Facebook, Twitter, and Evernote, but with the user in control of what kind of data they want to see and manage. 
      
      Whether it's social posts, marketplace listings, or personal notes, Thing Time puts the power of data organization and customization in the user’s hands.
    `,
    "Image URL": "https://google.com/images",
    Price: "$100",
    QTY: 1,
    ID: 123,
    Nested: {
      data: {
        is: {
          fun: "Isn't it?",
        },
      },
    },
    Array: ["one", "two", "three"],
    "Array of Objects": [
      {
        name: "one",
      },
      {
        name: "two",
      },
      {
        name: "three",
      },
    ],
    "Identical Keys unique1": "I'm unique 1",
    "Identical Keys unique2": "I'm unique 2",
    "Identical Keys unique3": "I'm unique 3",
  }

  const [demoThing, setDemoThing] = React.useState(thing)

  // const debug = {
  //   test: 'hey'
  // }

  // return null

  return (
    <Flex maxWidth="100%" paddingBottom={40}>
      <Thingtime width="600px" thing={demoThing}></Thingtime>
    </Flex>
  )
}
