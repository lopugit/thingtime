import { connect } from 'http2';
import { smarts } from '~/smarts';

export const thingtimeForced = {
  settings: {
    types: {
      javascript: {
        any: {
          type: 'any',
          value: () => {
            return null;
          }
        },
        object: {
          type: 'object',
          value: () => {
            return {};
          }
        },
        array: {
          type: 'array',
          value: () => {
            return [];
          }
        },
        string: {
          type: 'string',
          value: () => {
            return '';
          }
        },
        number: {
          type: 'number',
          value: () => {
            return 0;
          }
        },
        boolean: {
          type: 'boolean',
          value: () => {
            return false;
          }
        },
        function: {
          type: 'function',
          value: () => {
            return () => {};
          }
        }
      },
      custom: {
        'Thingtime Logo': {
          type: 'chakra',
          value: {
            type: 'chakra',
            chakra: 'Box',
            props: {
              fontSize: 12
            },
            rawChildren: ['🌈 Thingtime']
          }
        },
        'Violet Container Centered': {
          name: 'Violet Container Centered',
          type: 'chakra',
          icon: '💜',
          wrap: 'children',
          value: {
            name: 'Violet Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#AB47BC',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Indigo Container Centered': {
          name: 'Indigo Container Centered',
          type: 'chakra',
          icon: '🩷',
          wrap: 'children',
          value: {
            name: 'Indigo Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#5C6BC0',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Blue Container Centered': {
          name: 'Blue Container Centered',
          type: 'chakra',
          icon: '💙',
          wrap: 'children',
          value: {
            name: 'Blue Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#42A5F5',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Green Container Centered': {
          name: 'Green Container Centered',
          type: 'chakra',
          icon: '💚',
          wrap: 'children',
          value: {
            name: 'Green Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#66BB6A',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Yellow Container Centered': {
          name: 'Yellow Container Centered',
          type: 'chakra',
          icon: '💛',
          wrap: 'children',
          value: {
            name: 'Yellow Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#FFEE58',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Orange Container Centered': {
          name: 'Orange Container Centered',
          type: 'chakra',
          icon: '🧡',
          wrap: 'children',
          value: {
            name: 'Orange Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#FF7043',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Red Container Centered': {
          name: 'Red Container Centered',
          type: 'chakra',
          icon: '❤️',
          wrap: 'children',
          value: {
            name: 'Red Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#C62828',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Left Aligned': {
          type: 'chakra',
          value: {
            type: 'chakra',
            chakra: 'Flex',
            props: {
              mr: 'auto'
            },
            children: []
          }
        },
        'Right Aligned': {
          type: 'chakra',
          value: {
            type: 'chakra',
            chakra: 'Flex',
            props: {
              ml: 'auto'
            },
            children: []
          }
        }
      }
    }

    // undoLimit: 999,
    // commander: {
    //   nav: {
    //     commanderActive: false,
    //     clearCommanderOnToggle: true,
    //     clearCommanderContextOnToggle: true,
    //     hideSuggestionsOnToggle: true,
    // },
    // },
  },
  //   Content: {
  //     hidden1: "Edit this to your heart's desire.",
  //     "How?": "Just search for Content and edit the value to whatever you want.",
  //     "Example:": `Content = New Content!
  // Content.Nested Content = New Nested Content!
  //     `,
  //   },
  devKit: {
    testUsers: {
      default: {
        username: 'rick.deckard',
        password: 'password'
      }
    }
  }
};

// if the users local thingtime version is less than the new version then these values will overwrite any older values
// TODO: implement patch system the way blockchain does..
// db migration theory
export const thingtimeNewData = {};

const versions = [
  {
    version: 25,
    settings: {
      connectionUrls: ['mongodb://localhost:27017']
    }
  },
  {
    version: 24,
    Content: {
      hidden1: "Edit this to your heart's desire.",
      'How?': 'Just search for Content and edit the value to whatever you want.',
      'Example:': `Content = New Content!
      Content.Nested Content = New Nested Content!
    `
    }
  }
];

// merge all versions into one object using smarts.merge
export const mergedVersions = versions.reduce((acc, version) => {
  return smarts.merge(acc, version);
}, {});

console.log('nik mergedVersions', mergedVersions);

const defaultValues = {
  settings: {
    commander: {
      nav: {
        commanderActive: false,
        clearCommanderOnToggle: true,
        clearCommanderContextOnToggle: true,
        hideSuggestionsOnToggle: true
      }
    },
    connectionUrls: ['mongodb://localhost:27017']
  },
  Content: {
    hidden1: "Edit this to your heart's desire.",
    'How?': 'Just search for Content and edit the value to whatever you want.',
    'Example:': `
Content = New Content!
Content.Nested Content = New Nested Content!
    `
  }
};

export const thingtimeDefaults = smarts.merge(defaultValues, thingtimeForced);

// initialise thingtime
thingtimeDefaults.thingtime = thingtimeDefaults;
thingtimeDefaults.tt = thingtimeDefaults;

export default thingtimeDefaults;
