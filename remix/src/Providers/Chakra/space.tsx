const spaceObj = {}

const start = 0
const end = 9999

for (let i = start; i <= end; i++) {
  spaceObj[i] = `${i * 0.25}rem`
}

export const space = spaceObj
