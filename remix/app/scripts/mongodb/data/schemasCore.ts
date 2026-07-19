// Core sample schemas — 40 rich data-structure schemas modeled on Thingtime's
// kind gallery (Social / Media / Commerce / Planning), seeded through the real
// createThing path via data/schemas.ts. Pure data, no render trees (the
// showcase sibling covers those). Every entry stays well under the
// sanitizeSchemaCrystal caps: ≤40 field nodes, ≤6 levels deep.

import type { SeedSchema } from './schemas';

export const getCoreSchemas = async (): Promise<SeedSchema[]> => [
  // ————— Social —————
  {
    slug: 'post',
    owner: 'rick.deckard',
    name: 'Social post',
    description:
      'The classic feed unit 📮 — some text, a few tags, an author, and the reaction ' +
      'counts that tell you whether the internet smiled back. Every other shape on ' +
      'Thingtime is secretly friends with this one.',
    fields: [
      { name: 'text', type: 'string', required: true, maxLength: 2000, description: 'What you want to say.' },
      { name: 'tags', type: 'string[]', maxItems: 8, maxLength: 30 },
      { name: 'visibility', type: 'enum', values: ['public', 'friends', 'family', 'private'] },
      {
        name: 'author',
        type: 'object',
        children: [
          { name: 'username', type: 'string', required: true, maxLength: 40 },
          { name: 'displayName', type: 'string', maxLength: 60 }
        ]
      },
      { name: 'reactionCount', type: 'number', min: 0 },
      { name: 'commentCount', type: 'number', min: 0 },
      { name: 'postedAt', type: 'date' },
      { name: 'pinned', type: 'boolean' }
    ],
    tags: ['sample', 'social', 'feed'],
    extended: {
      sampleKit: { source: 'kind-gallery', version: 1 },
      notes: 'The starter shape — fork it, add fields, make it yours.'
    },
    ageHours: 3
  },
  {
    slug: 'profile',
    owner: 'rachael',
    name: 'Profile',
    description:
      'A person, as data 🪞 Bio, pronouns, a website, the things they love, and a ' +
      'little stats block for bragging rights. More human than human.',
    fields: [
      { name: 'username', type: 'string', required: true, maxLength: 40 },
      { name: 'displayName', type: 'string', maxLength: 60 },
      { name: 'bio', type: 'string', maxLength: 280, description: 'Your whole deal, in a sentence or two.' },
      { name: 'pronouns', type: 'string', maxLength: 30 },
      { name: 'location', type: 'string', maxLength: 80 },
      { name: 'website', type: 'string', maxLength: 200 },
      { name: 'interests', type: 'string[]', maxItems: 12, maxLength: 30 },
      {
        name: 'stats',
        type: 'object',
        children: [
          { name: 'things', type: 'number', min: 0 },
          { name: 'friends', type: 'number', min: 0 },
          { name: 'gardens', type: 'number', min: 0 }
        ]
      },
      { name: 'joinedAt', type: 'date' }
    ],
    tags: ['sample', 'social', 'identity'],
    ageHours: 26
  },
  {
    slug: 'quote',
    owner: 'coach.leo',
    name: 'Quote',
    description:
      'Words worth keeping 💬 Who said it, where, when, and what mood it puts you in. ' +
      'Collect them like pressed flowers.',
    fields: [
      { name: 'quote', type: 'string', required: true, maxLength: 500 },
      { name: 'attribution', type: 'string', maxLength: 80 },
      { name: 'source', type: 'string', maxLength: 120, description: 'Book, speech, overheard at the markets…' },
      { name: 'year', type: 'number', min: 0, max: 2100 },
      { name: 'mood', type: 'enum', values: ['uplifting', 'wry', 'stern', 'dreamy', 'spicy'] },
      { name: 'tags', type: 'string[]', maxItems: 6, maxLength: 30 }
    ],
    tags: ['sample', 'social'],
    ageHours: 55
  },
  {
    slug: 'email',
    owner: 'gary.tinfoil',
    name: 'Email',
    description:
      'The inbox shape 📬 From, to, subject, a teasing preview line, and attachments ' +
      'with honest file sizes. Unread badge included, anxiety optional.',
    fields: [
      { name: 'from', type: 'string', required: true, maxLength: 120 },
      { name: 'to', type: 'string[]', required: true, minItems: 1, maxItems: 20, maxLength: 120 },
      { name: 'subject', type: 'string', required: true, maxLength: 200 },
      { name: 'preview', type: 'string', maxLength: 300, description: 'The first line you see before you commit.' },
      { name: 'sentAt', type: 'date', required: true },
      { name: 'unread', type: 'boolean' },
      { name: 'folder', type: 'enum', values: ['inbox', 'sent', 'drafts', 'archive', 'spam'] },
      {
        name: 'attachments',
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          children: [
            { name: 'name', type: 'string', required: true, maxLength: 120 },
            { name: 'sizeKb', type: 'number', min: 0, unit: 'KB' }
          ]
        }
      }
    ],
    tags: ['sample', 'social', 'communication'],
    ageHours: 7
  },
  {
    slug: 'chat-message',
    owner: 'moss.gardener',
    name: 'Chat message',
    description:
      'One bubble of a conversation 💭 Who sent it, what they said, delivery status, ' +
      'and the emoji pile-on it earned. Threads are just these, stacked with love.',
    fields: [
      { name: 'from', type: 'string', required: true, maxLength: 40 },
      { name: 'text', type: 'string', required: true, maxLength: 1000 },
      { name: 'sentAt', type: 'date', required: true },
      { name: 'me', type: 'boolean', description: 'True when it is your own bubble.' },
      {
        name: 'reactions',
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          children: [
            { name: 'emoji', type: 'string', required: true, maxLength: 8 },
            { name: 'count', type: 'number', min: 0 }
          ]
        }
      },
      { name: 'replyTo', type: 'string', maxLength: 64, description: 'shareId of the message this answers.' },
      { name: 'status', type: 'enum', values: ['sending', 'sent', 'delivered', 'read'] }
    ],
    tags: ['sample', 'social', 'conversation'],
    ageHours: 2
  },
  {
    slug: 'contact',
    owner: 'sunny.raye',
    name: 'Contact',
    description:
      'A proper address-book card 📇 Name, role, how to reach them, where they live, ' +
      'and a notes field for the things you always forget (their dog is called Biscuit).',
    fields: [
      { name: 'name', type: 'string', required: true, maxLength: 80 },
      { name: 'role', type: 'string', maxLength: 80 },
      { name: 'organisation', type: 'string', maxLength: 80 },
      { name: 'phone', type: 'string', maxLength: 30 },
      { name: 'email', type: 'string', maxLength: 120 },
      {
        name: 'address',
        type: 'object',
        children: [
          { name: 'street', type: 'string', maxLength: 120 },
          { name: 'city', type: 'string', maxLength: 80 },
          { name: 'postcode', type: 'string', maxLength: 12 },
          { name: 'country', type: 'string', maxLength: 60 }
        ]
      },
      { name: 'birthday', type: 'date' },
      { name: 'favourite', type: 'boolean' },
      { name: 'notes', type: 'string', maxLength: 500 }
    ],
    tags: ['sample', 'social', 'people'],
    ageHours: 130
  },
  {
    slug: 'poll',
    owner: 'toolshed.tom',
    name: 'Poll',
    description:
      'Ask the crowd 🗳️ A question, up to ten options with live vote counts, and a ' +
      'closing time so democracy does not run forever. Pumpkins usually win.',
    fields: [
      { name: 'question', type: 'string', required: true, maxLength: 200 },
      {
        name: 'options',
        type: 'array',
        required: true,
        minItems: 2,
        maxItems: 10,
        items: {
          type: 'object',
          children: [
            { name: 'label', type: 'string', required: true, maxLength: 60 },
            { name: 'votes', type: 'number', min: 0 },
            { name: 'emoji', type: 'string', maxLength: 8 }
          ]
        }
      },
      { name: 'multipleChoice', type: 'boolean' },
      { name: 'anonymous', type: 'boolean', description: 'Hide who voted for what.' },
      { name: 'closesAt', type: 'date' },
      { name: 'totalVotes', type: 'number', min: 0 }
    ],
    tags: ['sample', 'social', 'voting'],
    ageHours: 18
  },
  {
    slug: 'review',
    owner: 'vintage.vera',
    name: 'Review',
    description:
      'An honest opinion with a star count ⭐ Pros, cons, whether you actually bought ' +
      'the thing, and room for the full story. Five stars for the yellow armchair.',
    fields: [
      { name: 'subject', type: 'string', required: true, maxLength: 120, description: 'What is being reviewed.' },
      { name: 'rating', type: 'number', required: true, min: 1, max: 5, unit: 'stars' },
      { name: 'title', type: 'string', maxLength: 120 },
      { name: 'text', type: 'string', maxLength: 2000 },
      { name: 'reviewer', type: 'string', maxLength: 60 },
      { name: 'verifiedPurchase', type: 'boolean' },
      { name: 'pros', type: 'string[]', maxItems: 8, maxLength: 80 },
      { name: 'cons', type: 'string[]', maxItems: 8, maxLength: 80 },
      { name: 'reviewedAt', type: 'date' }
    ],
    tags: ['sample', 'social', 'opinions'],
    ageHours: 44
  },
  {
    slug: 'faq',
    owner: 'rick.deckard',
    name: 'FAQ',
    description:
      'Questions people actually ask, answered once so you never type them again 🙋 ' +
      'Perfect for seed swaps, share houses, and anything with rules.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 120 },
      { name: 'topic', type: 'enum', values: ['community', 'product', 'events', 'billing', 'other'] },
      {
        name: 'items',
        type: 'array',
        required: true,
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          children: [
            { name: 'question', type: 'string', required: true, maxLength: 200 },
            { name: 'answer', type: 'string', required: true, maxLength: 1000 }
          ]
        }
      },
      { name: 'updatedAt', type: 'date' },
      { name: 'pinned', type: 'boolean' },
      { name: 'contactEmail', type: 'string', maxLength: 120, description: 'Where to send the questions this list missed.' }
    ],
    tags: ['sample', 'social', 'knowledge'],
    ageHours: 210
  },

  // ————— Media —————
  {
    slug: 'video',
    owner: 'rachael',
    name: 'Video',
    description:
      'Moving pictures with metadata that behaves 🎬 Title, channel, chapters with ' +
      'timestamps, and a view count to watch climb. Repotting tutorials welcome.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 140 },
      { name: 'channel', type: 'string', maxLength: 80 },
      { name: 'url', type: 'string', required: true, maxLength: 500 },
      { name: 'durationSeconds', type: 'number', min: 0, unit: 'seconds' },
      { name: 'views', type: 'number', min: 0 },
      { name: 'resolution', type: 'enum', values: ['480p', '720p', '1080p', '4K', '8K'] },
      {
        name: 'chapters',
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          children: [
            { name: 'title', type: 'string', required: true, maxLength: 100 },
            { name: 'startsAtSeconds', type: 'number', min: 0, unit: 'seconds' }
          ]
        }
      },
      { name: 'tags', type: 'string[]', maxItems: 10, maxLength: 30 },
      { name: 'publishedAt', type: 'date' }
    ],
    tags: ['sample', 'media', 'video'],
    extended: {
      demo: { chapterAutogen: true },
      credits: ['filmed on a potato', 'edited with love']
    },
    ageHours: 12
  },
  {
    slug: 'image',
    owner: 'coach.leo',
    name: 'Image gallery',
    description:
      'Photos with their paperwork done 📸 Every image keeps its alt text, dimensions, ' +
      'and licence, plus a caption and credit for the set. Accessibility is a feature.',
    fields: [
      { name: 'caption', type: 'string', maxLength: 300 },
      { name: 'credit', type: 'string', maxLength: 80 },
      { name: 'album', type: 'string', maxLength: 80, description: 'Which collection this set belongs to.' },
      {
        name: 'images',
        type: 'array',
        required: true,
        minItems: 1,
        maxItems: 12,
        items: {
          type: 'object',
          children: [
            { name: 'src', type: 'string', maxLength: 500 },
            { name: 'alt', type: 'string', required: true, maxLength: 200, description: 'Describe it for someone who cannot see it.' },
            { name: 'widthPx', type: 'number', min: 1, unit: 'px' },
            { name: 'heightPx', type: 'number', min: 1, unit: 'px' }
          ]
        }
      },
      { name: 'takenAt', type: 'date' },
      { name: 'license', type: 'enum', values: ['all-rights-reserved', 'cc-by', 'cc-by-sa', 'cc0', 'public-domain'] }
    ],
    tags: ['sample', 'media', 'photos'],
    ageHours: 31
  },
  {
    slug: 'audio',
    owner: 'gary.tinfoil',
    name: 'Audio track',
    description:
      'One track, fully labelled 🎧 Artist, album, genre, and a loop flag for the rainy ' +
      'garden recordings you play seventeen times in a row.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 140 },
      { name: 'artist', type: 'string', maxLength: 80 },
      { name: 'album', type: 'string', maxLength: 120 },
      { name: 'durationSeconds', type: 'number', min: 0, unit: 'seconds' },
      { name: 'src', type: 'string', maxLength: 500 },
      { name: 'genre', type: 'enum', values: ['ambient', 'field-recording', 'folk', 'electronic', 'classical', 'spoken-word'] },
      { name: 'loop', type: 'boolean' },
      { name: 'recordedAt', type: 'date' }
    ],
    tags: ['sample', 'media', 'sound'],
    ageHours: 88
  },
  {
    slug: 'playlist',
    owner: 'moss.gardener',
    name: 'Playlist',
    description:
      'Songs in a deliberate order 🎶 A curator, a mood, up to thirty tracks, and a ' +
      'collaborative switch so the whole seed-swap crew can add bangers.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 120 },
      { name: 'curator', type: 'string', maxLength: 60 },
      { name: 'mood', type: 'enum', values: ['focus', 'sunrise', 'rainy-day', 'party', 'wind-down'] },
      {
        name: 'tracks',
        type: 'array',
        required: true,
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          children: [
            { name: 'title', type: 'string', required: true, maxLength: 140 },
            { name: 'artist', type: 'string', maxLength: 80 },
            { name: 'durationSeconds', type: 'number', min: 0, unit: 'seconds' }
          ]
        }
      },
      { name: 'collaborative', type: 'boolean' },
      { name: 'followers', type: 'number', min: 0 },
      { name: 'updatedAt', type: 'date' }
    ],
    tags: ['sample', 'media', 'music'],
    extended: {
      sampleKit: { source: 'kind-gallery', version: 1 },
      vibeCheck: 'passed'
    },
    ageHours: 61
  },
  {
    slug: 'podcast-episode',
    owner: 'sunny.raye',
    name: 'Podcast episode',
    description:
      'One episode of talking into the void, beautifully structured 🎙️ Show, season, ' +
      'guests, an explicit flag, and a duration you will absolutely listen to at 1.5x.',
    fields: [
      { name: 'show', type: 'string', required: true, maxLength: 120 },
      { name: 'episodeTitle', type: 'string', required: true, maxLength: 160 },
      { name: 'episodeNumber', type: 'number', min: 1 },
      { name: 'season', type: 'number', min: 1 },
      { name: 'description', type: 'string', maxLength: 500 },
      { name: 'durationMinutes', type: 'number', min: 0, unit: 'min' },
      { name: 'explicit', type: 'boolean' },
      { name: 'guests', type: 'string[]', maxItems: 10, maxLength: 60 },
      { name: 'audioUrl', type: 'string', maxLength: 500 },
      { name: 'publishedAt', type: 'date' }
    ],
    tags: ['sample', 'media', 'podcast'],
    extended: {
      transcriptAvailable: true,
      hosting: { provider: 'thingcast', tier: 'free' }
    },
    ageHours: 9
  },
  {
    slug: 'article',
    owner: 'toolshed.tom',
    name: 'Article',
    description:
      'Long-form words with a byline 📰 Source, section, reading time, and an excerpt ' +
      'good enough to earn the click. Paywall flag included for honesty.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 160 },
      { name: 'author', type: 'string', maxLength: 80 },
      { name: 'source', type: 'string', maxLength: 100 },
      { name: 'excerpt', type: 'string', maxLength: 400 },
      { name: 'readingTimeMinutes', type: 'number', min: 1, unit: 'min' },
      { name: 'section', type: 'enum', values: ['news', 'opinion', 'how-to', 'interview', 'review', 'longread'] },
      { name: 'tags', type: 'string[]', maxItems: 8, maxLength: 30 },
      { name: 'heroImageUrl', type: 'string', maxLength: 500 },
      { name: 'publishedAt', type: 'date', required: true },
      { name: 'paywalled', type: 'boolean' }
    ],
    tags: ['sample', 'media', 'reading'],
    ageHours: 23
  },
  {
    slug: 'book',
    owner: 'vintage.vera',
    name: 'Book',
    description:
      'A book on your shelf, as data 📚 Format, genres, a star rating, and a read ' +
      'status that goes from to-read to finished (or, honestly, abandoned).',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 160 },
      { name: 'author', type: 'string', required: true, maxLength: 100 },
      { name: 'year', type: 'number', min: 0, max: 2100 },
      { name: 'pages', type: 'number', min: 1, unit: 'pages' },
      { name: 'rating', type: 'number', min: 0, max: 5, unit: 'stars' },
      { name: 'format', type: 'enum', values: ['hardcover', 'paperback', 'ebook', 'audiobook'] },
      { name: 'genres', type: 'string[]', maxItems: 6, maxLength: 40 },
      { name: 'blurb', type: 'string', maxLength: 500 },
      { name: 'readStatus', type: 'enum', values: ['to-read', 'reading', 'finished', 'abandoned'] },
      { name: 'finishedAt', type: 'date' }
    ],
    tags: ['sample', 'media', 'books'],
    ageHours: 300
  },
  {
    slug: 'movie',
    owner: 'rick.deckard',
    name: 'Movie',
    description:
      'Everything a film card needs 🎥 Director, runtime, genres, a cast list with ' +
      'roles, and a watched flag for settling arguments about what to put on tonight.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 160 },
      { name: 'year', type: 'number', min: 1888, max: 2100 },
      { name: 'runtimeMinutes', type: 'number', min: 1, unit: 'min' },
      { name: 'rating', type: 'number', min: 0, max: 10 },
      { name: 'genres', type: 'string[]', maxItems: 6, maxLength: 30 },
      { name: 'director', type: 'string', maxLength: 80 },
      { name: 'synopsis', type: 'string', maxLength: 500 },
      { name: 'watched', type: 'boolean' },
      {
        name: 'cast',
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          children: [
            { name: 'actor', type: 'string', required: true, maxLength: 80 },
            { name: 'role', type: 'string', maxLength: 80 }
          ]
        }
      }
    ],
    tags: ['sample', 'media', 'film'],
    ageHours: 150
  },
  {
    slug: 'link',
    owner: 'rachael',
    name: 'Link',
    description:
      'A bookmark that remembers why you saved it 🔖 Title, description, the site it ' +
      'came from, and a read-later flag you will definitely honour this time.',
    fields: [
      { name: 'url', type: 'string', required: true, maxLength: 500 },
      { name: 'title', type: 'string', maxLength: 160 },
      { name: 'description', type: 'string', maxLength: 300 },
      { name: 'site', type: 'string', maxLength: 100 },
      { name: 'faviconUrl', type: 'string', maxLength: 500 },
      { name: 'savedAt', type: 'date' },
      { name: 'readLater', type: 'boolean' },
      { name: 'tags', type: 'string[]', maxItems: 8, maxLength: 30 }
    ],
    tags: ['sample', 'media', 'bookmarks'],
    ageHours: 5
  },
  {
    slug: 'file',
    owner: 'coach.leo',
    name: 'File',
    description:
      'A file card with the details that matter 🗂️ Type, size, checksum for the ' +
      'paranoid, who it is shared with, and a star for the ones you actually open.',
    fields: [
      { name: 'name', type: 'string', required: true, maxLength: 160 },
      { name: 'type', type: 'enum', values: ['pdf', 'image', 'video', 'audio', 'archive', 'spreadsheet', 'doc', 'other'] },
      { name: 'sizeKb', type: 'number', min: 0, unit: 'KB' },
      { name: 'url', type: 'string', maxLength: 500 },
      { name: 'checksum', type: 'string', maxLength: 128 },
      { name: 'modifiedAt', type: 'date' },
      { name: 'sharedWith', type: 'string[]', maxItems: 20, maxLength: 40 },
      { name: 'starred', type: 'boolean' }
    ],
    tags: ['sample', 'media', 'storage'],
    ageHours: 96
  },

  // ————— Commerce —————
  {
    slug: 'listing',
    owner: 'gary.tinfoil',
    name: 'Marketplace listing',
    description:
      'One thing for sale, honestly described 🛋️ Price, condition, category, photos, ' +
      'and a sold flag for the sweet moment it finds a new home. Pick-up only.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 120 },
      { name: 'price', type: 'number', required: true, min: 0 },
      { name: 'currency', type: 'enum', values: ['AUD', 'USD', 'EUR', 'GBP', 'NZD'] },
      { name: 'condition', type: 'enum', values: ['new', 'like-new', 'used', 'for-parts'] },
      { name: 'category', type: 'enum', values: ['car', 'tool', 'furniture', 'service', 'other'] },
      { name: 'location', type: 'string', maxLength: 100 },
      { name: 'description', type: 'string', maxLength: 1000 },
      { name: 'photos', type: 'string[]', maxItems: 10, maxLength: 500 },
      { name: 'sold', type: 'boolean' },
      { name: 'postedAt', type: 'date' }
    ],
    tags: ['sample', 'commerce', 'marketplace'],
    ageHours: 15
  },
  {
    slug: 'product',
    owner: 'moss.gardener',
    name: 'Product',
    description:
      'A shop-shelf product with real depth 🛒 Variants with SKUs, a compare-at price ' +
      'for the strikethrough, ratings, and honest dimensions so it fits through the door.',
    fields: [
      { name: 'name', type: 'string', required: true, maxLength: 140 },
      { name: 'price', type: 'number', required: true, min: 0 },
      { name: 'compareAt', type: 'number', min: 0, description: 'The before price that makes the sale feel good.' },
      { name: 'currency', type: 'enum', values: ['AUD', 'USD', 'EUR', 'GBP', 'NZD'] },
      { name: 'rating', type: 'number', min: 0, max: 5, unit: 'stars' },
      { name: 'reviewCount', type: 'number', min: 0 },
      { name: 'inStock', type: 'boolean' },
      {
        name: 'variants',
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          children: [
            { name: 'label', type: 'string', required: true, maxLength: 60 },
            { name: 'sku', type: 'string', maxLength: 40 },
            { name: 'priceDelta', type: 'number' }
          ]
        }
      },
      {
        name: 'dimensions',
        type: 'object',
        children: [
          { name: 'widthCm', type: 'number', min: 0, unit: 'cm' },
          { name: 'heightCm', type: 'number', min: 0, unit: 'cm' },
          { name: 'depthCm', type: 'number', min: 0, unit: 'cm' },
          { name: 'weightKg', type: 'number', min: 0, unit: 'kg' }
        ]
      }
    ],
    tags: ['sample', 'commerce', 'shop'],
    ageHours: 72
  },
  {
    slug: 'order',
    owner: 'sunny.raye',
    name: 'Order',
    description:
      'A receipt that keeps its shape 🧾 Line items with quantities, subtotal plus ' +
      'shipping equals total, and a status that marches from pending to delivered.',
    fields: [
      { name: 'orderNumber', type: 'string', required: true, maxLength: 40 },
      { name: 'status', type: 'enum', required: true, values: ['pending', 'paid', 'packed', 'shipped', 'delivered', 'refunded'] },
      { name: 'currency', type: 'enum', values: ['AUD', 'USD', 'EUR', 'GBP', 'NZD'] },
      {
        name: 'items',
        type: 'array',
        required: true,
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          children: [
            { name: 'name', type: 'string', required: true, maxLength: 140 },
            { name: 'qty', type: 'number', required: true, min: 1 },
            { name: 'unitPrice', type: 'number', min: 0 }
          ]
        }
      },
      { name: 'subtotal', type: 'number', min: 0 },
      { name: 'shipping', type: 'number', min: 0 },
      { name: 'total', type: 'number', required: true, min: 0 },
      { name: 'placedAt', type: 'date', required: true },
      { name: 'giftWrap', type: 'boolean' }
    ],
    tags: ['sample', 'commerce', 'orders'],
    extended: {
      sampleKit: { source: 'kind-gallery', version: 2 },
      testCard: 'always-approves'
    },
    ageHours: 38
  },
  {
    slug: 'shipment',
    owner: 'toolshed.tom',
    name: 'Shipment',
    description:
      'Where is my parcel, as a schema 📦 Carrier, tracking number, an ETA, and a ' +
      'step-by-step journey so you can refresh it every twenty minutes with dignity.',
    fields: [
      { name: 'carrier', type: 'string', required: true, maxLength: 60 },
      { name: 'trackingNumber', type: 'string', required: true, maxLength: 60 },
      { name: 'status', type: 'enum', values: ['label-created', 'packed', 'shipped', 'in-transit', 'out-for-delivery', 'delivered', 'returned'] },
      { name: 'eta', type: 'date' },
      {
        name: 'steps',
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          children: [
            { name: 'label', type: 'string', required: true, maxLength: 60 },
            { name: 'at', type: 'date' },
            { name: 'done', type: 'boolean' }
          ]
        }
      },
      { name: 'origin', type: 'string', maxLength: 100 },
      { name: 'destination', type: 'string', maxLength: 100 },
      { name: 'weightKg', type: 'number', min: 0, unit: 'kg' },
      { name: 'signatureRequired', type: 'boolean' }
    ],
    tags: ['sample', 'commerce', 'delivery'],
    ageHours: 20
  },
  {
    slug: 'coupon',
    owner: 'vintage.vera',
    name: 'Coupon',
    description:
      'A little rectangle of joy 🎟️ Code, discount, what it applies to, a minimum ' +
      'spend, and an expiry date you should probably check before the checkout sulks.',
    fields: [
      { name: 'code', type: 'string', required: true, maxLength: 30 },
      { name: 'discountPercent', type: 'number', min: 1, max: 100, unit: '%' },
      { name: 'description', type: 'string', maxLength: 200 },
      { name: 'brand', type: 'string', maxLength: 80 },
      { name: 'appliesTo', type: 'string[]', maxItems: 10, maxLength: 60 },
      { name: 'minSpend', type: 'number', min: 0 },
      { name: 'expiresAt', type: 'date' },
      { name: 'singleUse', type: 'boolean' }
    ],
    tags: ['sample', 'commerce', 'deals'],
    ageHours: 170
  },
  {
    slug: 'donation',
    owner: 'rick.deckard',
    name: 'Donation drive',
    description:
      'A fundraiser with a heartbeat 💛 Goal, raised-so-far, supporter count, and ' +
      'milestones that light up as the community gets the greenhouse built.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 140 },
      { name: 'description', type: 'string', maxLength: 500 },
      { name: 'goal', type: 'number', required: true, min: 1 },
      { name: 'raised', type: 'number', min: 0 },
      { name: 'currency', type: 'enum', values: ['AUD', 'USD', 'EUR', 'GBP', 'NZD'] },
      { name: 'supporters', type: 'number', min: 0 },
      { name: 'organiser', type: 'string', maxLength: 80 },
      { name: 'endsAt', type: 'date' },
      {
        name: 'milestones',
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          children: [
            { name: 'amount', type: 'number', required: true, min: 0 },
            { name: 'label', type: 'string', maxLength: 100 },
            { name: 'reached', type: 'boolean' }
          ]
        }
      }
    ],
    tags: ['sample', 'commerce', 'community'],
    extended: {
      receiptTemplate: 'warm-and-fuzzy',
      taxDeductible: true
    },
    ageHours: 47
  },
  {
    slug: 'subscription',
    owner: 'rachael',
    name: 'Subscription',
    description:
      'The recurring kind of commitment 🔁 Plan, price, billing period, the feature ' +
      'list that sold you, and an auto-renew switch you know exactly where to find.',
    fields: [
      { name: 'plan', type: 'string', required: true, maxLength: 60 },
      { name: 'price', type: 'number', required: true, min: 0 },
      { name: 'currency', type: 'enum', values: ['AUD', 'USD', 'EUR', 'GBP', 'NZD'] },
      { name: 'period', type: 'enum', required: true, values: ['week', 'month', 'quarter', 'year'] },
      { name: 'features', type: 'string[]', maxItems: 12, maxLength: 80 },
      { name: 'startedAt', type: 'date' },
      { name: 'renewsAt', type: 'date' },
      { name: 'autoRenew', type: 'boolean' },
      { name: 'seats', type: 'number', min: 1, max: 500, unit: 'seats' }
    ],
    tags: ['sample', 'commerce', 'billing'],
    ageHours: 240
  },
  {
    slug: 'stock-holding',
    owner: 'coach.leo',
    name: 'Stock holding',
    description:
      'One line of a portfolio 📈 Ticker, shares held, what you paid versus what it is ' +
      'worth now, and a watch-only flag for the ones you are still just admiring.',
    fields: [
      { name: 'symbol', type: 'string', required: true, maxLength: 10 },
      { name: 'companyName', type: 'string', maxLength: 100 },
      { name: 'shares', type: 'number', required: true, min: 0, unit: 'shares' },
      { name: 'avgBuyPrice', type: 'number', min: 0 },
      { name: 'currentPrice', type: 'number', min: 0 },
      { name: 'currency', type: 'enum', values: ['USD', 'AUD', 'EUR', 'GBP'] },
      { name: 'exchange', type: 'enum', values: ['ASX', 'NYSE', 'NASDAQ', 'LSE', 'TSE'] },
      { name: 'purchasedAt', type: 'date' },
      { name: 'dividendYieldPercent', type: 'number', min: 0, max: 100, unit: '%' },
      { name: 'watchOnly', type: 'boolean' }
    ],
    tags: ['sample', 'commerce', 'finance'],
    ageHours: 110
  },
  {
    slug: 'budget',
    owner: 'gary.tinfoil',
    name: 'Budget',
    description:
      'Money with a plan 💸 Categories with spent-versus-budget, an optional rollover ' +
      'per category, and a notes field for explaining the tools overspend. Again.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 100 },
      { name: 'currency', type: 'enum', values: ['AUD', 'USD', 'EUR', 'GBP', 'NZD'] },
      { name: 'period', type: 'enum', values: ['week', 'month', 'quarter', 'year'] },
      {
        name: 'categories',
        type: 'array',
        required: true,
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          children: [
            { name: 'label', type: 'string', required: true, maxLength: 60 },
            { name: 'budget', type: 'number', required: true, min: 0 },
            { name: 'spent', type: 'number', min: 0 },
            { name: 'rollover', type: 'boolean' }
          ]
        }
      },
      { name: 'totalBudget', type: 'number', min: 0 },
      { name: 'startsAt', type: 'date' },
      { name: 'notes', type: 'string', maxLength: 300 }
    ],
    tags: ['sample', 'commerce', 'finance'],
    extended: {
      spreadsheetRefugee: true,
      importedFrom: 'budget-2026.xlsx'
    },
    ageHours: 66
  },
  {
    slug: 'property',
    owner: 'moss.gardener',
    name: 'Property listing',
    description:
      'A home with its facts straight 🏡 Beds, baths, parking, land size, a structured ' +
      'address, and the feature list (northern light! established garden! good bones!).',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 140 },
      { name: 'listingType', type: 'enum', required: true, values: ['for-sale', 'for-rent', 'auction', 'sold'] },
      { name: 'price', type: 'number', min: 0 },
      { name: 'currency', type: 'enum', values: ['AUD', 'USD', 'EUR', 'GBP', 'NZD'] },
      { name: 'beds', type: 'number', min: 0, unit: 'beds' },
      { name: 'baths', type: 'number', min: 0, unit: 'baths' },
      { name: 'parking', type: 'number', min: 0, unit: 'cars' },
      { name: 'landSquareMetres', type: 'number', min: 0, unit: 'm²' },
      {
        name: 'address',
        type: 'object',
        children: [
          { name: 'street', type: 'string', maxLength: 120 },
          { name: 'suburb', type: 'string', maxLength: 80 },
          { name: 'state', type: 'string', maxLength: 40 },
          { name: 'postcode', type: 'string', maxLength: 12 }
        ]
      },
      { name: 'features', type: 'string[]', maxItems: 12, maxLength: 60 },
      { name: 'openHouseAt', type: 'date' }
    ],
    tags: ['sample', 'commerce', 'realestate'],
    ageHours: 190
  },
  {
    slug: 'job-posting',
    owner: 'sunny.raye',
    name: 'Job posting',
    description:
      'A role worth applying for 💼 Salary range out in the open, remote policy stated ' +
      'plainly, requirements and perks as tidy lists. No "competitive salary" mysteries.',
    fields: [
      { name: 'role', type: 'string', required: true, maxLength: 100 },
      { name: 'company', type: 'string', required: true, maxLength: 100 },
      { name: 'location', type: 'string', maxLength: 100 },
      { name: 'remote', type: 'enum', values: ['on-site', 'hybrid', 'remote'] },
      { name: 'employmentType', type: 'enum', values: ['full-time', 'part-time', 'contract', 'casual', 'internship'] },
      { name: 'salaryMin', type: 'number', min: 0 },
      { name: 'salaryMax', type: 'number', min: 0 },
      { name: 'currency', type: 'enum', values: ['AUD', 'USD', 'EUR', 'GBP', 'NZD'] },
      { name: 'description', type: 'string', maxLength: 2000 },
      { name: 'requirements', type: 'string[]', maxItems: 12, maxLength: 120 },
      { name: 'perks', type: 'string[]', maxItems: 10, maxLength: 80 },
      { name: 'postedAt', type: 'date' },
      { name: 'closesAt', type: 'date' }
    ],
    tags: ['sample', 'commerce', 'work'],
    ageHours: 29
  },
  {
    slug: 'menu',
    owner: 'toolshed.tom',
    name: 'Menu',
    description:
      'A café menu that nests like the real thing 🍽️ Sections hold dishes, dishes ' +
      'carry prices, blurbs, and dietary tags. The basil scramble is from the north bed.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 100 },
      { name: 'venue', type: 'string', maxLength: 100 },
      { name: 'currency', type: 'enum', values: ['AUD', 'USD', 'EUR', 'GBP', 'NZD'] },
      {
        name: 'sections',
        type: 'array',
        required: true,
        minItems: 1,
        maxItems: 12,
        items: {
          type: 'object',
          children: [
            { name: 'name', type: 'string', required: true, maxLength: 60 },
            {
              name: 'items',
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                children: [
                  { name: 'name', type: 'string', required: true, maxLength: 80 },
                  { name: 'price', type: 'number', min: 0 },
                  { name: 'description', type: 'string', maxLength: 200 },
                  { name: 'dietary', type: 'string[]', maxItems: 6, maxLength: 20 }
                ]
              }
            }
          ]
        }
      },
      { name: 'updatedAt', type: 'date' },
      { name: 'takeaway', type: 'boolean' }
    ],
    tags: ['sample', 'commerce', 'food'],
    extended: {
      chefsNote: 'Prices wander with the seasons, like the tomatoes.',
      printFriendly: true
    },
    ageHours: 350
  },

  // ————— Planning —————
  {
    slug: 'task',
    owner: 'vintage.vera',
    name: 'Task',
    description:
      'One thing to do, done properly ✅ Priority, due date, an assignee, and a ' +
      'subtasks checklist inside — so a task can be its own tiny task list when it grows up.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 140 },
      { name: 'done', type: 'boolean' },
      { name: 'dueAt', type: 'date' },
      { name: 'priority', type: 'enum', values: ['low', 'medium', 'high', 'urgent'] },
      { name: 'assignee', type: 'string', maxLength: 40 },
      { name: 'notes', type: 'string', maxLength: 500 },
      { name: 'tags', type: 'string[]', maxItems: 8, maxLength: 30 },
      {
        name: 'subtasks',
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          children: [
            { name: 'title', type: 'string', required: true, maxLength: 140 },
            { name: 'done', type: 'boolean' }
          ]
        }
      },
      { name: 'estimateMinutes', type: 'number', min: 0, unit: 'min' }
    ],
    tags: ['sample', 'planning', 'todo'],
    ageHours: 4
  },
  {
    slug: 'timeline',
    owner: 'rick.deckard',
    name: 'Timeline',
    description:
      'History, one entry at a time 🕰️ Each moment gets a when, a title, a story, and ' +
      'an optional emoji marker. Great for gardens, projects, and lives well lived.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 120 },
      {
        name: 'entries',
        type: 'array',
        required: true,
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          children: [
            { name: 'when', type: 'string', required: true, maxLength: 40, description: 'A year, a date, or "that one summer".' },
            { name: 'title', type: 'string', required: true, maxLength: 120 },
            { name: 'description', type: 'string', maxLength: 300 },
            { name: 'icon', type: 'string', maxLength: 8 }
          ]
        }
      },
      { name: 'curator', type: 'string', maxLength: 60 },
      { name: 'startYear', type: 'number', min: 0, max: 2100 },
      { name: 'ongoing', type: 'boolean' },
      { name: 'theme', type: 'enum', values: ['garden', 'project', 'life', 'history', 'product'] }
    ],
    tags: ['sample', 'planning', 'history'],
    ageHours: 400
  },
  {
    slug: 'milestone',
    owner: 'rachael',
    name: 'Milestone',
    description:
      'A goal with a progress bar 🎯 Target, current count, a unit of your choosing, ' +
      'and a celebrated flag — because hitting 30 plants deserves cake.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 120 },
      { name: 'target', type: 'number', required: true, min: 0 },
      { name: 'current', type: 'number', min: 0 },
      { name: 'unit', type: 'string', maxLength: 20, description: 'plants, kilometres, chapters…' },
      { name: 'progressPercent', type: 'number', min: 0, max: 100, unit: '%' },
      { name: 'deadline', type: 'date' },
      { name: 'celebrated', type: 'boolean' },
      { name: 'note', type: 'string', maxLength: 300 }
    ],
    tags: ['sample', 'planning', 'goals'],
    ageHours: 82
  },
  {
    slug: 'event',
    owner: 'coach.leo',
    name: 'Event',
    description:
      'Something happening, somewhere, soon 🎪 Start and end times, a venue or an ' +
      'online flag, RSVP count against capacity, and a bring-list for the lemonade.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 140 },
      { name: 'startsAt', type: 'date', required: true },
      { name: 'endsAt', type: 'date' },
      { name: 'venue', type: 'string', maxLength: 140 },
      { name: 'online', type: 'boolean' },
      { name: 'description', type: 'string', maxLength: 500 },
      { name: 'rsvpCount', type: 'number', min: 0 },
      { name: 'capacity', type: 'number', min: 1 },
      { name: 'host', type: 'string', maxLength: 80 },
      { name: 'vibe', type: 'enum', values: ['casual', 'fancy', 'workshop', 'festival', 'meeting'] },
      { name: 'bring', type: 'string[]', maxItems: 10, maxLength: 60 }
    ],
    tags: ['sample', 'planning', 'events'],
    ageHours: 11
  },
  {
    slug: 'ticket',
    owner: 'gary.tinfoil',
    name: 'Ticket',
    description:
      'Proof you are going 🎫 Event, holder, seat and section, the code they scan at ' +
      'the gate, and a transferable flag for when plans change (they will).',
    fields: [
      { name: 'event', type: 'string', required: true, maxLength: 140 },
      { name: 'holder', type: 'string', required: true, maxLength: 80 },
      { name: 'date', type: 'date', required: true },
      { name: 'section', type: 'string', maxLength: 20 },
      { name: 'seat', type: 'string', maxLength: 20 },
      { name: 'code', type: 'string', required: true, maxLength: 40 },
      { name: 'pricePaid', type: 'number', min: 0 },
      { name: 'currency', type: 'enum', values: ['AUD', 'USD', 'EUR', 'GBP', 'NZD'] },
      { name: 'transferable', type: 'boolean' },
      { name: 'entry', type: 'enum', values: ['general', 'vip', 'backstage', 'early-bird'] }
    ],
    tags: ['sample', 'planning', 'events'],
    ageHours: 58
  },
  {
    slug: 'calendar',
    owner: 'moss.gardener',
    name: 'Calendar',
    description:
      'A week you can hold 📅 Days hold events, events hold times, titles, and places. ' +
      'Water the beds at 7, turn the compost at 6, inspection with Fern on Thursday.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 100 },
      { name: 'timezone', type: 'string', maxLength: 40 },
      {
        name: 'days',
        type: 'array',
        required: true,
        maxItems: 14,
        items: {
          type: 'object',
          children: [
            { name: 'date', type: 'date', required: true },
            {
              name: 'events',
              type: 'array',
              maxItems: 12,
              items: {
                type: 'object',
                children: [
                  { name: 'time', type: 'string', maxLength: 10 },
                  { name: 'title', type: 'string', required: true, maxLength: 120 },
                  { name: 'location', type: 'string', maxLength: 100 }
                ]
              }
            }
          ]
        }
      },
      { name: 'weekStartsOn', type: 'enum', values: ['monday', 'sunday'] },
      { name: 'shared', type: 'boolean', description: 'Visible to the whole household.' },
      { name: 'notes', type: 'string', maxLength: 300 }
    ],
    tags: ['sample', 'planning', 'time'],
    extended: {
      sampleKit: { source: 'kind-gallery', version: 1 }
    },
    ageHours: 6
  },
  {
    slug: 'itinerary',
    owner: 'sunny.raye',
    name: 'Itinerary',
    description:
      'A trip, day by day 🗺️ Destination, travellers, each day with its stops, and a ' +
      'packing list so the emergency snacks are never forgotten. Iceland awaits.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 120 },
      { name: 'destination', type: 'string', maxLength: 100 },
      { name: 'startsAt', type: 'date' },
      { name: 'endsAt', type: 'date' },
      { name: 'travellers', type: 'number', min: 1, max: 20, unit: 'people' },
      {
        name: 'days',
        type: 'array',
        required: true,
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          children: [
            { name: 'label', type: 'string', required: true, maxLength: 80, description: 'e.g. "Day 2 — Golden Circle".' },
            { name: 'stops', type: 'string[]', minItems: 1, maxItems: 12, maxLength: 100 },
            { name: 'note', type: 'string', maxLength: 200 }
          ]
        }
      },
      { name: 'packingList', type: 'string[]', maxItems: 20, maxLength: 60 }
    ],
    tags: ['sample', 'planning', 'travel'],
    ageHours: 270
  },
  {
    slug: 'booking',
    owner: 'toolshed.tom',
    name: 'Booking',
    description:
      'A stay, confirmed 🏕️ Check-in and check-out, guest count, nightly price, a host ' +
      'to call when the hot water misbehaves, and a free-cancellation safety net.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 140 },
      { name: 'confirmation', type: 'string', required: true, maxLength: 40 },
      { name: 'checkInAt', type: 'date', required: true },
      { name: 'checkOutAt', type: 'date', required: true },
      { name: 'guests', type: 'number', min: 1, max: 20, unit: 'guests' },
      { name: 'location', type: 'string', maxLength: 140 },
      { name: 'status', type: 'enum', values: ['pending', 'confirmed', 'cancelled', 'completed'] },
      { name: 'pricePerNight', type: 'number', min: 0 },
      { name: 'currency', type: 'enum', values: ['AUD', 'USD', 'EUR', 'GBP', 'NZD'] },
      {
        name: 'host',
        type: 'object',
        children: [
          { name: 'name', type: 'string', maxLength: 80 },
          { name: 'phone', type: 'string', maxLength: 30 }
        ]
      },
      { name: 'freeCancellation', type: 'boolean' }
    ],
    tags: ['sample', 'planning', 'travel'],
    ageHours: 140
  },
  {
    slug: 'flight',
    owner: 'vintage.vera',
    name: 'Flight',
    description:
      'Wings, as data ✈️ Airports with codes and cities, departure and arrival times, ' +
      'gate, seat, cabin class, and a status that hopefully never says delayed.',
    fields: [
      { name: 'flightNumber', type: 'string', required: true, maxLength: 10 },
      {
        name: 'from',
        type: 'object',
        children: [
          { name: 'code', type: 'string', required: true, maxLength: 4, description: 'IATA code, e.g. BNE.' },
          { name: 'city', type: 'string', maxLength: 80 }
        ]
      },
      {
        name: 'to',
        type: 'object',
        children: [
          { name: 'code', type: 'string', required: true, maxLength: 4 },
          { name: 'city', type: 'string', maxLength: 80 }
        ]
      },
      { name: 'departsAt', type: 'date', required: true },
      { name: 'arrivesAt', type: 'date' },
      { name: 'gate', type: 'string', maxLength: 6 },
      { name: 'seat', type: 'string', maxLength: 5 },
      { name: 'cabin', type: 'enum', values: ['economy', 'premium-economy', 'business', 'first'] },
      { name: 'status', type: 'enum', values: ['scheduled', 'boarding', 'departed', 'landed', 'delayed', 'cancelled'] },
      { name: 'bags', type: 'number', min: 0, max: 10, unit: 'bags' }
    ],
    tags: ['sample', 'planning', 'travel'],
    extended: {
      checklist: ['passport', 'headphones', 'emergency snacks'],
      loungeAccess: false
    },
    ageHours: 36
  }
];
