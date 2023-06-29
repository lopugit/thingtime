import React from 'react'
import { Thingtime } from './Thingtime'

export const ThingtimeDemo = props => {
  const thing = {
    name: 'thing',
    description: 'thing description',
    image: 'thing image',
    price: 100,
    quantity: 1,
    id: 1,
    nested: {
      data: {
        is: {
          fun: "Isn't it?"
        }
      }
    }
  }

  const [demoThing, setDemoThing] = React.useState(thing)

  const debug = {
    test: 'hey'
  }

  return null

  return <Thingtime thing={debug}></Thingtime>
}
