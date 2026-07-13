// Showcase sample schemas — the render-forward half of the /schemas seed set.
// Group 1: knowledge/life/world data shapes modeled on the kind gallery.
// Group 2: render showcases — each carries a serialised component tree
// (chakra or element shaped) in `render`, drawn through the sanitising
// allowlist renderers. Same constraints as data/schemas.ts.

import type { SeedSchema } from './schemas';

export const getShowcaseSchemas = async (): Promise<SeedSchema[]> => [
  // ————————————————————————————————————————————————————————————————
  // GROUP 1 — knowledge / life / world data schemas (no render)
  // ————————————————————————————————————————————————————————————————
  {
    slug: 'dashboard',
    owner: 'rick.deckard',
    name: 'Dashboard',
    description:
      'A tidy little control room for anything you count 📊 Give it a title, pick a period, and stack up metrics — each one carries a label, a headline value, a change, and a sparkline series. Watch your garden, your savings, or your replicant retirements from one card.',
    fields: [
      { name: 'title', type: 'string', required: true, description: 'What this dashboard watches.' },
      { name: 'period', type: 'enum', values: ['day', 'week', 'month', 'quarter'], description: 'Window the metrics cover.' },
      { name: 'refreshedAt', type: 'date', description: 'When the numbers were last pulled.' },
      { name: 'theme', type: 'enum', values: ['light', 'dark', 'rainbow'] },
      {
        name: 'metrics',
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          children: [
            { name: 'label', type: 'string', required: true },
            { name: 'value', type: 'string', required: true, description: 'Display value, e.g. "23" or "3.4kg".' },
            { name: 'change', type: 'number', unit: '%', description: 'Change vs the previous period.' },
            { name: 'series', type: 'array', maxItems: 30, items: { type: 'number' }, description: 'Sparkline points.' }
          ]
        }
      }
    ],
    tags: ['dashboard', 'metrics', 'analytics'],
    extended: { sampleKit: { source: 'kind-gallery', version: 1 } },
    ageHours: 6
  },
  {
    slug: 'chart',
    owner: 'rachael',
    name: 'Chart',
    description:
      'One chart, zero chart libraries in your data 📈 Labels down one list, values down the other, pick a type, and the renderer does the drawing. Rainfall, mood, pumpkin girth — if it has numbers over time, it fits here.',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'type', type: 'enum', values: ['bar', 'line', 'area', 'pie', 'scatter'], required: true },
      { name: 'labels', type: 'string[]', minItems: 1, maxItems: 30, description: 'One label per data point.' },
      { name: 'values', type: 'array', minItems: 1, maxItems: 30, items: { type: 'number' } },
      { name: 'unit', type: 'string', maxLength: 20, description: 'Display unit, e.g. "mm".' },
      { name: 'source', type: 'string', description: 'Where the numbers came from.' }
    ],
    tags: ['chart', 'data', 'visualisation'],
    ageHours: 12
  },
  {
    slug: 'comparison',
    owner: 'toolshed.tom',
    name: 'Comparison',
    description:
      'Line your candidates up and let the columns fight it out ⚖️ Each item gets a name, a price, a rating, and honest pros and cons. Perfect for watering cans, laptops, or which mate owes you lunch.',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'criteria', type: 'string[]', maxItems: 12, description: 'What you judged them on.' },
      {
        name: 'items',
        type: 'array',
        minItems: 2,
        maxItems: 8,
        items: {
          type: 'object',
          children: [
            { name: 'name', type: 'string', required: true },
            { name: 'price', type: 'string' },
            { name: 'rating', type: 'number', min: 0, max: 5 },
            { name: 'pros', type: 'string[]', maxItems: 8 },
            { name: 'cons', type: 'string[]', maxItems: 8 }
          ]
        }
      },
      { name: 'verdict', type: 'string', description: 'The winner, in one sentence.' }
    ],
    tags: ['comparison', 'shopping', 'decisions'],
    ageHours: 20
  },
  {
    slug: 'news-analysis',
    owner: 'gary.tinfoil',
    name: 'News Analysis',
    description:
      'Read the news like a detective 🕵️ One headline, a bias dial, claim-by-claim verdicts, and how each outlet spun it. Gary insists the sources list is the most important field. Gary is right.',
    fields: [
      { name: 'headline', type: 'string', required: true },
      { name: 'summary', type: 'string', maxLength: 500 },
      { name: 'bias', type: 'number', min: -1, max: 1, description: '-1 left, 0 centre, 1 right.' },
      {
        name: 'claims',
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          children: [
            { name: 'claim', type: 'string', required: true },
            { name: 'verdict', type: 'enum', values: ['verified', 'misleading', 'unverified', 'false'] }
          ]
        }
      },
      {
        name: 'perspectives',
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          children: [
            { name: 'outlet', type: 'string', required: true },
            { name: 'lean', type: 'enum', values: ['left', 'lean left', 'centre', 'lean right', 'right'] },
            { name: 'take', type: 'string' }
          ]
        }
      },
      { name: 'sources', type: 'string[]', maxItems: 20 }
    ],
    tags: ['news', 'analysis', 'media'],
    extended: { methodology: { spectrum: ['left', 'centre', 'right'], updated: '2026-06' } },
    ageHours: 28
  },
  {
    slug: 'code-snippet',
    owner: 'toolshed.tom',
    name: 'Code Snippet',
    description:
      'A snippet with a home 🧰 Filename, language, the code itself, and a note about why it exists. Because gists deserve to live next to your garden photos.',
    fields: [
      { name: 'filename', type: 'string', required: true },
      { name: 'language', type: 'enum', values: ['ts', 'tsx', 'js', 'python', 'rust', 'go', 'css', 'html', 'sql', 'other'] },
      { name: 'code', type: 'string', required: true, maxLength: 4000 },
      { name: 'description', type: 'string', maxLength: 300 },
      { name: 'tags', type: 'string[]', maxItems: 8 },
      { name: 'runnable', type: 'boolean', description: 'Safe to paste and run as-is.' }
    ],
    tags: ['code', 'snippet', 'dev'],
    ageHours: 36
  },
  {
    slug: 'repository',
    owner: 'toolshed.tom',
    name: 'Repository',
    description:
      'A repo card without the tab-hoarding 🗃️ Owner, name, language, stars, forks, topics, and when someone last pushed. Pin your favourites into a feed and pretend it is a trophy shelf.',
    fields: [
      { name: 'owner', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'string', maxLength: 300 },
      { name: 'language', type: 'string' },
      { name: 'stars', type: 'number', min: 0 },
      { name: 'forks', type: 'number', min: 0 },
      { name: 'url', type: 'string' },
      { name: 'topics', type: 'string[]', maxItems: 10 },
      { name: 'lastCommit', type: 'date' }
    ],
    tags: ['code', 'repository', 'dev'],
    ageHours: 44
  },
  {
    slug: 'definition',
    owner: 'rick.deckard',
    name: 'Definition',
    description:
      'A dictionary entry you actually own 📖 Word, phonetics, part of speech, as many meanings as it has moods, plus an example sentence. Collect the words that follow you around.',
    fields: [
      { name: 'word', type: 'string', required: true },
      { name: 'phonetic', type: 'string', maxLength: 60 },
      { name: 'partOfSpeech', type: 'enum', values: ['noun', 'verb', 'adjective', 'adverb', 'interjection', 'other'] },
      { name: 'meanings', type: 'string[]', minItems: 1, maxItems: 10 },
      { name: 'example', type: 'string', maxLength: 300 },
      { name: 'origin', type: 'string', maxLength: 200 }
    ],
    tags: ['words', 'definition', 'knowledge'],
    ageHours: 52
  },
  {
    slug: 'changelog',
    owner: 'gary.tinfoil',
    name: 'Changelog',
    description:
      'Ship it, then say so 🚀 A version, a date, and a typed list of changes — Added, Improved, Fixed, Removed, Security. Works for apps, gardens, and personal growth arcs.',
    fields: [
      { name: 'project', type: 'string' },
      { name: 'version', type: 'string', required: true },
      { name: 'date', type: 'date' },
      {
        name: 'changes',
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          children: [
            { name: 'type', type: 'enum', values: ['Added', 'Improved', 'Fixed', 'Removed', 'Security'] },
            { name: 'text', type: 'string', required: true }
          ]
        }
      }
    ],
    tags: ['changelog', 'release', 'dev'],
    ageHours: 60
  },
  {
    slug: 'certificate',
    owner: 'rachael',
    name: 'Certificate',
    description:
      'Proof you did the thing 🎓 Title, recipient, issuer, dates, a credential id, and the skills it certifies. Frame it in a feed instead of a drawer.',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'recipient', type: 'string', required: true },
      { name: 'issuer', type: 'string' },
      { name: 'issuedOn', type: 'date' },
      { name: 'expires', type: 'date' },
      { name: 'credentialId', type: 'string', maxLength: 60 },
      { name: 'verifyUrl', type: 'string' },
      { name: 'skills', type: 'string[]', maxItems: 12 }
    ],
    tags: ['certificate', 'learning', 'achievement'],
    ageHours: 70
  },
  {
    slug: 'course',
    owner: 'sunny.raye',
    name: 'Course',
    description:
      'A course you can actually see yourself finishing 🌞 Provider, level, lesson count, a progress dial, and a syllabus of modules with minutes. Watching the percentage climb is half the curriculum.',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'provider', type: 'string' },
      { name: 'level', type: 'enum', values: ['beginner', 'intermediate', 'advanced'] },
      { name: 'lessons', type: 'number', min: 0 },
      { name: 'duration', type: 'string', maxLength: 40 },
      { name: 'progress', type: 'number', min: 0, max: 100, unit: '%' },
      {
        name: 'syllabus',
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          children: [
            { name: 'module', type: 'string', required: true },
            { name: 'minutes', type: 'number', min: 0, unit: 'min' }
          ]
        }
      },
      { name: 'description', type: 'string', maxLength: 400 }
    ],
    tags: ['course', 'learning', 'education'],
    ageHours: 82
  },
  {
    slug: 'leaderboard',
    owner: 'coach.leo',
    name: 'Leaderboard',
    description:
      'Friendly competition, ranked and public 🏆 Entries carry a rank, a name, a score, and how far they moved since last time. Pumpkin weigh-offs, plank-off seconds, book counts — the podium does not judge.',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'unit', type: 'string', maxLength: 20, description: 'What the score measures, e.g. "kg".' },
      {
        name: 'entries',
        type: 'array',
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          children: [
            { name: 'rank', type: 'number', min: 1 },
            { name: 'name', type: 'string', required: true },
            { name: 'score', type: 'number' },
            { name: 'delta', type: 'number', description: 'Places moved since the last round.' }
          ]
        }
      },
      { name: 'resetsAt', type: 'date' }
    ],
    tags: ['leaderboard', 'games', 'community'],
    ageHours: 95
  },
  {
    slug: 'match-result',
    owner: 'coach.leo',
    name: 'Match Result',
    description:
      'The full-time card ⚽ Two sides with scores and scorers, a status, a venue, and kickoff time. Backyard cups count exactly as much as world cups here.',
    fields: [
      { name: 'competition', type: 'string', required: true },
      { name: 'status', type: 'enum', values: ['scheduled', 'live', 'full-time', 'postponed'] },
      {
        name: 'home',
        type: 'object',
        children: [
          { name: 'name', type: 'string', required: true },
          { name: 'score', type: 'number', min: 0 },
          { name: 'scorers', type: 'string[]', maxItems: 12 }
        ]
      },
      {
        name: 'away',
        type: 'object',
        children: [
          { name: 'name', type: 'string', required: true },
          { name: 'score', type: 'number', min: 0 },
          { name: 'scorers', type: 'string[]', maxItems: 12 }
        ]
      },
      { name: 'venue', type: 'string' },
      { name: 'kickoff', type: 'date' }
    ],
    tags: ['sport', 'match', 'score'],
    ageHours: 110
  },
  {
    slug: 'recipe',
    owner: 'moss.gardener',
    name: 'Recipe',
    description:
      'Dinner as structured data 🍝 Ingredients with amounts, numbered steps, a difficulty dial, and a little nutrition block. Fork a friend\'s pesto, tweak the garlic, publish yours back.',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'time', type: 'string', maxLength: 30 },
      { name: 'serves', type: 'number', min: 1 },
      { name: 'difficulty', type: 'enum', values: ['easy', 'medium', 'hard'] },
      {
        name: 'ingredients',
        type: 'array',
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          children: [
            { name: 'item', type: 'string', required: true },
            { name: 'amount', type: 'string', maxLength: 40 }
          ]
        }
      },
      { name: 'steps', type: 'string[]', minItems: 1, maxItems: 30 },
      {
        name: 'nutrition',
        type: 'object',
        children: [
          { name: 'kcal', type: 'number', min: 0, unit: 'kcal' },
          { name: 'protein', type: 'number', min: 0, unit: 'g' }
        ]
      },
      { name: 'tags', type: 'string[]', maxItems: 8 }
    ],
    tags: ['recipe', 'food', 'cooking'],
    extended: { nutrition: { kcal: 320, vegan: true } },
    ageHours: 3
  },
  {
    slug: 'place',
    owner: 'moss.gardener',
    name: 'Place',
    description:
      'A pin with personality 📍 Name, address, coordinates, a category, opening hours, and a note about why it matters. Your favourite bench deserves a record as much as any cafe.',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'address', type: 'string' },
      { name: 'lat', type: 'number', min: -90, max: 90 },
      { name: 'lng', type: 'number', min: -180, max: 180 },
      { name: 'category', type: 'enum', values: ['garden', 'cafe', 'park', 'beach', 'shop', 'home', 'other'] },
      { name: 'openHours', type: 'string', maxLength: 100 },
      { name: 'note', type: 'string', maxLength: 300 },
      { name: 'photos', type: 'string[]', maxItems: 6 }
    ],
    tags: ['place', 'map', 'travel'],
    ageHours: 140
  },
  {
    slug: 'weather-report',
    owner: 'sunny.raye',
    name: 'Weather Report',
    description:
      'Sunny\'s favourite schema, obviously ☀️ Current temp, condition, highs and lows, humidity, wind, and a five-slot forecast. Enough structure to plan a picnic, not enough to jinx it.',
    fields: [
      { name: 'location', type: 'string', required: true },
      { name: 'temp', type: 'number', unit: '°C' },
      { name: 'condition', type: 'enum', values: ['sunny', 'partly cloudy', 'cloudy', 'showers', 'rain', 'storm', 'windy', 'snow'] },
      { name: 'high', type: 'number', unit: '°C' },
      { name: 'low', type: 'number', unit: '°C' },
      { name: 'humidity', type: 'number', min: 0, max: 100, unit: '%' },
      { name: 'windKph', type: 'number', min: 0, unit: 'km/h' },
      {
        name: 'forecast',
        type: 'array',
        maxItems: 7,
        items: {
          type: 'object',
          children: [
            { name: 'day', type: 'string', required: true },
            { name: 'condition', type: 'string' },
            { name: 'high', type: 'number', unit: '°C' },
            { name: 'low', type: 'number', unit: '°C' }
          ]
        }
      }
    ],
    tags: ['weather', 'forecast', 'daily'],
    extended: { station: { id: 'BYR-04', provider: 'demo' } },
    ageHours: 2
  },
  {
    slug: 'workout',
    owner: 'coach.leo',
    name: 'Workout',
    description:
      'Coach Leo\'s session card 💪 A focus, a duration, a calorie estimate, and exercises with sets, reps, and weight. Wheelbarrow lunges are a real exercise if you believe hard enough.',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'focus', type: 'enum', values: ['strength', 'cardio', 'mobility', 'mixed'] },
      { name: 'duration', type: 'string', maxLength: 30 },
      { name: 'calories', type: 'number', min: 0, unit: 'kcal' },
      {
        name: 'exercises',
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          children: [
            { name: 'name', type: 'string', required: true },
            { name: 'sets', type: 'number', min: 1 },
            { name: 'reps', type: 'string', maxLength: 20 },
            { name: 'weight', type: 'string', maxLength: 20 }
          ]
        }
      },
      { name: 'notes', type: 'string', maxLength: 300 }
    ],
    tags: ['workout', 'fitness', 'health'],
    ageHours: 8
  },
  {
    slug: 'plant',
    owner: 'moss.gardener',
    name: 'Plant',
    description:
      'Every plant gets a name and a file 🌿 Species, watering rhythm, light needs, height, a happiness flag, and room for notes. Moss says if you track it, you will not kill it. Mostly.',
    fields: [
      { name: 'name', type: 'string', required: true, description: 'The name you actually call it.' },
      { name: 'species', type: 'string' },
      { name: 'water', type: 'enum', values: ['daily', 'every few days', 'weekly', 'fortnightly', 'monthly'] },
      { name: 'light', type: 'enum', values: ['low', 'medium', 'bright indirect', 'full sun'] },
      { name: 'lastWatered', type: 'date' },
      { name: 'height', type: 'number', min: 0, unit: 'cm' },
      { name: 'happy', type: 'boolean' },
      { name: 'notes', type: 'string', maxLength: 500 }
    ],
    tags: ['plant', 'garden', 'care'],
    extended: { careLog: { mistings: 4, fertilised: '2026-07-01' } },
    ageHours: 16
  },

  // ————————————————————————————————————————————————————————————————
  // GROUP 2 — render showcases: the `render` property IS the component
  // ————————————————————————————————————————————————————————————————
  {
    slug: 'stat-tile',
    owner: 'toolshed.tom',
    name: 'Stat Tile',
    description:
      'One number, loudly 📈 The render property on this schema is not a screenshot — it IS the component: a serialised Chakra Stat card stored as JSON and drawn live through the allowlist renderer. The fields describe the number it shows.',
    fields: [
      { name: 'label', type: 'string', required: true },
      { name: 'value', type: 'string', required: true },
      { name: 'change', type: 'number', unit: '%' },
      { name: 'trend', type: 'enum', values: ['up', 'down', 'flat'] },
      { name: 'caption', type: 'string', maxLength: 120 }
    ],
    render: {
      type: 'chakra',
      chakra: 'Card',
      props: { maxW: '240px', borderRadius: 'xl', boxShadow: 'md' },
      children: [
        {
          chakra: 'CardBody',
          children: [
            {
              chakra: 'Stat',
              children: [
                { chakra: 'StatLabel', props: { color: 'gray.500' }, rawChildren: ['Seedlings sprouted 🌱'] },
                { chakra: 'StatNumber', props: { fontSize: '3xl' }, rawChildren: ['128'] },
                {
                  chakra: 'StatHelpText',
                  children: [{ chakra: 'StatArrow', props: { type: 'increase' } }, '23% since last week']
                }
              ]
            }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'stat'],
    extended: { demo: { series: [98, 104, 111, 120, 128] } },
    ageHours: 5
  },
  {
    slug: 'pricing-card',
    owner: 'vintage.vera',
    name: 'Pricing Card',
    description:
      'A pricing tier that ships its own pixels 💳 The render tree is the component — gradient header, big price, feature list, call-to-action button — all plain JSON drawn through the Chakra allowlist. Fields hold the plan data behind it.',
    fields: [
      { name: 'plan', type: 'string', required: true },
      { name: 'price', type: 'number', min: 0 },
      { name: 'period', type: 'enum', values: ['month', 'year'] },
      { name: 'features', type: 'string[]', maxItems: 10 },
      { name: 'highlight', type: 'boolean' },
      { name: 'cta', type: 'string', maxLength: 40 }
    ],
    render: {
      type: 'chakra',
      chakra: 'Card',
      props: { maxW: '280px', borderRadius: '2xl', overflow: 'hidden', boxShadow: 'lg' },
      children: [
        {
          chakra: 'Box',
          props: { bgGradient: 'linear(to-r, purple.500, pink.400)', p: 6, color: 'white' },
          children: [
            { chakra: 'Heading', props: { size: 'sm', textTransform: 'uppercase', letterSpacing: 'wide' }, rawChildren: ['Bloom'] },
            {
              chakra: 'HStack',
              props: { alignItems: 'baseline', mt: 2 },
              children: [
                { chakra: 'Text', props: { fontSize: '4xl', fontWeight: 'bold' }, rawChildren: ['$9'] },
                { chakra: 'Text', props: { fontSize: 'sm', opacity: 0.8 }, rawChildren: ['/month'] }
              ]
            }
          ]
        },
        {
          chakra: 'CardBody',
          children: [
            {
              chakra: 'List',
              props: { spacing: 3, fontSize: 'sm' },
              children: [
                { chakra: 'ListItem', rawChildren: ['✅ Unlimited things'] },
                { chakra: 'ListItem', rawChildren: ['✅ Shareable themes'] },
                { chakra: 'ListItem', rawChildren: ['✅ Kind templates'] },
                { chakra: 'ListItem', rawChildren: ['✅ Rainbow mode 🌈'] }
              ]
            },
            { chakra: 'Button', props: { colorScheme: 'purple', width: '100%', mt: 5, borderRadius: 'full' }, rawChildren: ['Start blooming'] }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'pricing'],
    extended: { billing: { trialDays: 14, currency: 'USD' } },
    ageHours: 14
  },
  {
    slug: 'testimonial-card',
    owner: 'rachael',
    name: 'Testimonial Card',
    description:
      'Kind words, framed nicely 💬 The render property IS the card: quote, avatar, name, role, and a row of stars — a serialised Chakra tree, not a picture of one. Swap the fields and the same shape tells your story.',
    fields: [
      { name: 'quote', type: 'string', required: true, maxLength: 300 },
      { name: 'author', type: 'string', required: true },
      { name: 'role', type: 'string', maxLength: 80 },
      { name: 'rating', type: 'number', min: 0, max: 5 }
    ],
    render: {
      type: 'chakra',
      chakra: 'Card',
      props: { maxW: '340px', borderRadius: 'xl', boxShadow: 'md' },
      children: [
        {
          chakra: 'CardBody',
          children: [
            {
              chakra: 'VStack',
              props: { alignItems: 'flex-start', spacing: 4 },
              children: [
                {
                  chakra: 'Text',
                  props: { fontSize: 'lg', fontStyle: 'italic' },
                  rawChildren: ['“I put my whole life in here and it started rendering back at me.”']
                },
                {
                  chakra: 'HStack',
                  props: { spacing: 3 },
                  children: [
                    { chakra: 'Avatar', props: { name: 'Rachael T' } },
                    {
                      chakra: 'Box',
                      children: [
                        { chakra: 'Text', props: { fontWeight: 'bold' }, rawChildren: ['Rachael T.'] },
                        { chakra: 'Text', props: { fontSize: 'sm', color: 'gray.500' }, rawChildren: ['Memory enthusiast'] }
                      ]
                    }
                  ]
                },
                { chakra: 'Text', props: { color: 'yellow.400', letterSpacing: '2px' }, rawChildren: ['★★★★★'] }
              ]
            }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'testimonial'],
    ageHours: 24
  },
  {
    slug: 'hero-banner',
    owner: 'sunny.raye',
    name: 'Hero Banner',
    description:
      'A landing-page hero you can hug 🌅 Gradient sky, big friendly headline, two buttons — the render tree is the whole component, stored as JSON and drawn live. Fields carry the words so you can re-skin without re-writing.',
    fields: [
      { name: 'headline', type: 'string', required: true, maxLength: 120 },
      { name: 'subheadline', type: 'string', maxLength: 200 },
      { name: 'ctaLabel', type: 'string', maxLength: 40 },
      { name: 'ctaHref', type: 'string' }
    ],
    render: {
      type: 'chakra',
      chakra: 'Box',
      props: { bgGradient: 'linear(to-br, teal.400, blue.600)', color: 'white', p: 10, borderRadius: '2xl', textAlign: 'center' },
      children: [
        { chakra: 'Heading', props: { size: 'xl' }, rawChildren: ['Your data, in bloom 🌸'] },
        {
          chakra: 'Text',
          props: { mt: 3, fontSize: 'lg', opacity: 0.9 },
          rawChildren: ['Every thing you keep can look like something. This banner is one of them.']
        },
        {
          chakra: 'HStack',
          props: { justifyContent: 'center', mt: 6, spacing: 4 },
          children: [
            { chakra: 'Button', props: { bg: 'white', color: 'blue.600', borderRadius: 'full' }, rawChildren: ['Get started'] },
            { chakra: 'Button', props: { variant: 'outline', color: 'white', borderRadius: 'full' }, rawChildren: ['Tour the garden'] }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'hero'],
    ageHours: 34
  },
  {
    slug: 'profile-badge',
    owner: 'rick.deckard',
    name: 'Profile Badge',
    description:
      'A pocket-sized identity card 🪪 Avatar, display name, a verified badge, and a one-line bio — the render property is the component itself, serialised Chakra all the way down. Clip it into any feed.',
    fields: [
      { name: 'username', type: 'string', required: true },
      { name: 'displayName', type: 'string', required: true },
      { name: 'tagline', type: 'string', maxLength: 120 },
      { name: 'verified', type: 'boolean' }
    ],
    render: {
      type: 'chakra',
      chakra: 'Box',
      props: { p: 4, borderRadius: 'xl', borderWidth: '1px', maxW: '320px' },
      children: [
        {
          chakra: 'HStack',
          props: { spacing: 4 },
          children: [
            { chakra: 'Avatar', props: { name: 'Rick Deckard', size: 'md' } },
            {
              chakra: 'VStack',
              props: { alignItems: 'flex-start', spacing: 0 },
              children: [
                {
                  chakra: 'HStack',
                  props: { spacing: 2 },
                  children: [
                    { chakra: 'Text', props: { fontWeight: 'bold' }, rawChildren: ['Rick Deckard'] },
                    { chakra: 'Badge', props: { colorScheme: 'blue', borderRadius: 'full' }, rawChildren: ['✔ verified'] }
                  ]
                },
                { chakra: 'Text', props: { fontSize: 'sm', color: 'gray.500' }, rawChildren: ['@rick.deckard'] },
                { chakra: 'Text', props: { fontSize: 'sm' }, rawChildren: ['Cataloguing electric sheep 🐑'] }
              ]
            }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'profile'],
    ageHours: 48
  },
  {
    slug: 'gradient-card',
    owner: 'moss.gardener',
    name: 'Gradient Card',
    description:
      'Pure JSON, pure sunset 🧱 This one uses the element tree — tag, props, children — instead of Chakra, so the render property is literally HTML-as-data drawn through the sanitising gate. Pick an accent, change the words, keep the glow.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 80 },
      { name: 'body', type: 'string', maxLength: 300 },
      { name: 'accent', type: 'enum', values: ['sunrise', 'ocean', 'forest', 'berry'] }
    ],
    render: {
      tag: 'div',
      props: {
        style: {
          padding: '24px',
          borderRadius: '18px',
          background: 'linear-gradient(135deg, #ffe9a8 0%, #ff9a8b 50%, #c77dff 100%)',
          textAlign: 'center'
        }
      },
      children: [
        {
          tag: 'h3',
          props: { style: { margin: 0, fontSize: '20px', color: '#241832' } },
          children: ['This card is a gradient with feelings 🌇']
        },
        {
          tag: 'p',
          props: { style: { margin: '10px 0 0', fontSize: '13px', color: '#3c2a4d' } },
          children: ['No components were imported. It is JSON, rendered through the element allowlist.']
        },
        {
          tag: 'button',
          props: {
            style: {
              marginTop: '16px',
              padding: '8px 20px',
              borderRadius: '999px',
              border: 'none',
              background: '#241832',
              color: '#ffffff',
              fontWeight: 700
            }
          },
          children: ['Bask in it']
        }
      ]
    },
    tags: ['render', 'element', 'gradient'],
    ageHours: 58
  },
  {
    slug: 'progress-tracker',
    owner: 'coach.leo',
    name: 'Progress Tracker',
    description:
      'A goal with a pulse 🏁 Name the goal, feed it a percentage, and the render tree — a live Chakra Progress bar wrapped in a card — shows how close you are. The component ships inside the schema; the fields drive it.',
    fields: [
      { name: 'goal', type: 'string', required: true },
      { name: 'progress', type: 'number', min: 0, max: 100, unit: '%', required: true },
      { name: 'statusNote', type: 'string', maxLength: 200 }
    ],
    render: {
      type: 'chakra',
      chakra: 'Card',
      props: { maxW: '360px', borderRadius: 'xl' },
      children: [
        {
          chakra: 'CardBody',
          children: [
            {
              chakra: 'VStack',
              props: { alignItems: 'stretch', spacing: 3 },
              children: [
                {
                  chakra: 'HStack',
                  children: [
                    { chakra: 'Text', props: { fontWeight: 'bold' }, rawChildren: ['Grow 30 plants 🌿'] },
                    { chakra: 'Spacer' },
                    { chakra: 'Badge', props: { colorScheme: 'green', borderRadius: 'full' }, rawChildren: ['76%'] }
                  ]
                },
                { chakra: 'Progress', props: { value: 76, colorScheme: 'green', borderRadius: 'full', height: '10px' } },
                { chakra: 'Text', props: { fontSize: 'sm', color: 'gray.500' }, rawChildren: ['23 of 30 — the seedlings are sprinting since the rain.'] }
              ]
            }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'progress'],
    ageHours: 66
  },
  {
    slug: 'feature-grid',
    owner: 'vintage.vera',
    name: 'Feature Grid',
    description:
      'Three tidy reasons in a row ✨ A SimpleGrid of emoji, titles, and blurbs — the render property is the whole marketing section, serialised as a Chakra tree. Fields describe the features so the copy stays data.',
    fields: [
      { name: 'title', type: 'string', required: true, maxLength: 80 },
      {
        name: 'features',
        type: 'array',
        minItems: 1,
        maxItems: 9,
        items: {
          type: 'object',
          children: [
            { name: 'emoji', type: 'string', maxLength: 8 },
            { name: 'name', type: 'string', required: true },
            { name: 'blurb', type: 'string', maxLength: 160 }
          ]
        }
      }
    ],
    render: {
      type: 'chakra',
      chakra: 'Box',
      props: { p: 6, borderRadius: '2xl', borderWidth: '1px' },
      children: [
        { chakra: 'Heading', props: { size: 'md', textAlign: 'center', mb: 5 }, rawChildren: ['Why Thingtime? 🌈'] },
        {
          chakra: 'SimpleGrid',
          props: { columns: 3, gap: 4 },
          children: [
            {
              chakra: 'Box',
              props: { p: 4, borderRadius: 'lg', bg: 'purple.50', textAlign: 'center' },
              children: [
                { chakra: 'Text', props: { fontSize: '2xl' }, rawChildren: ['🧺'] },
                { chakra: 'Text', props: { fontWeight: 'bold', mt: 1 }, rawChildren: ['Keep everything'] },
                { chakra: 'Text', props: { fontSize: 'sm', color: 'gray.600' }, rawChildren: ['Every thing is a thing.'] }
              ]
            },
            {
              chakra: 'Box',
              props: { p: 4, borderRadius: 'lg', bg: 'teal.50', textAlign: 'center' },
              children: [
                { chakra: 'Text', props: { fontSize: '2xl' }, rawChildren: ['🎨'] },
                { chakra: 'Text', props: { fontWeight: 'bold', mt: 1 }, rawChildren: ['Render anything'] },
                { chakra: 'Text', props: { fontSize: 'sm', color: 'gray.600' }, rawChildren: ['Data wears templates.'] }
              ]
            },
            {
              chakra: 'Box',
              props: { p: 4, borderRadius: 'lg', bg: 'pink.50', textAlign: 'center' },
              children: [
                { chakra: 'Text', props: { fontSize: '2xl' }, rawChildren: ['🤝'] },
                { chakra: 'Text', props: { fontWeight: 'bold', mt: 1 }, rawChildren: ['Share it all'] },
                { chakra: 'Text', props: { fontSize: 'sm', color: 'gray.600' }, rawChildren: ['Schemas travel well.'] }
              ]
            }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'marketing'],
    ageHours: 78
  },
  {
    slug: 'alert-banner',
    owner: 'gary.tinfoil',
    name: 'Alert Banner',
    description:
      'A heads-up that renders itself 🚨 Status, title, message — and the render property carries the actual Chakra Alert, icon and all. Gary uses the warning variant. Gary uses only the warning variant.',
    fields: [
      { name: 'status', type: 'enum', values: ['info', 'success', 'warning', 'error'], required: true },
      { name: 'title', type: 'string', required: true, maxLength: 80 },
      { name: 'message', type: 'string', maxLength: 300 }
    ],
    render: {
      type: 'chakra',
      chakra: 'Alert',
      props: { status: 'success', variant: 'subtle', borderRadius: 'lg' },
      children: [
        { chakra: 'AlertIcon' },
        {
          chakra: 'Box',
          children: [
            { chakra: 'AlertTitle', rawChildren: ['Seeds planted!'] },
            { chakra: 'AlertDescription', rawChildren: ['Your schema is live on /schemas. Water occasionally.'] }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'alert'],
    ageHours: 90
  },
  {
    slug: 'avatar-stack',
    owner: 'rachael',
    name: 'Avatar Stack',
    description:
      'The whole crew in one overlapping row 🫂 An AvatarGroup with names becomes initials automatically — the render tree IS the component, no image uploads required. Fields list the members behind the faces.',
    fields: [
      { name: 'title', type: 'string', maxLength: 80 },
      {
        name: 'members',
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          children: [
            { name: 'name', type: 'string', required: true },
            { name: 'role', type: 'string', maxLength: 60 }
          ]
        }
      }
    ],
    render: {
      type: 'chakra',
      chakra: 'Box',
      props: { p: 4, borderRadius: 'xl', borderWidth: '1px', maxW: '320px' },
      children: [
        {
          chakra: 'HStack',
          props: { spacing: 4 },
          children: [
            {
              chakra: 'AvatarGroup',
              props: { size: 'md', max: 3 },
              children: [
                { chakra: 'Avatar', props: { name: 'Moss Gardener' } },
                { chakra: 'Avatar', props: { name: 'Sunny Raye' } },
                { chakra: 'Avatar', props: { name: 'Toolshed Tom' } },
                { chakra: 'Avatar', props: { name: 'Vintage Vera' } }
              ]
            },
            { chakra: 'Text', props: { fontSize: 'sm', color: 'gray.500' }, rawChildren: ['Gardening together 🌱'] }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'people'],
    ageHours: 104
  },
  {
    slug: 'tag-cloud',
    owner: 'gary.tinfoil',
    name: 'Tag Cloud',
    description:
      'Topics, weighted by enthusiasm ☁️ An element-shaped render — plain tags, props, and children — where font size does the talking. The fields hold the tag list; the JSON holds the cloud.',
    fields: [
      { name: 'topic', type: 'string', maxLength: 80 },
      { name: 'tags', type: 'string[]', minItems: 1, maxItems: 30 }
    ],
    render: {
      tag: 'div',
      props: {
        style: {
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          borderRadius: '18px',
          background: '#f6f4ff'
        }
      },
      children: [
        { tag: 'span', props: { style: { fontSize: '26px', fontWeight: 700, color: '#6d28d9' } }, children: ['gardening'] },
        { tag: 'span', props: { style: { fontSize: '15px', color: '#0e7490' } }, children: ['compost'] },
        { tag: 'span', props: { style: { fontSize: '21px', fontWeight: 600, color: '#be185d' } }, children: ['rainbows'] },
        { tag: 'span', props: { style: { fontSize: '13px', color: '#4d7c0f' } }, children: ['seed-swap'] },
        { tag: 'span', props: { style: { fontSize: '18px', color: '#b45309' } }, children: ['pumpkins'] },
        { tag: 'span', props: { style: { fontSize: '14px', color: '#1d4ed8' } }, children: ['schemas'] },
        { tag: 'span', props: { style: { fontSize: '23px', fontWeight: 700, color: '#0f766e' } }, children: ['thingtime'] }
      ]
    },
    tags: ['render', 'element', 'tags'],
    ageHours: 122
  },
  {
    slug: 'countdown-card',
    owner: 'rick.deckard',
    name: 'Countdown Card',
    description:
      'The wait, visualised ⏳ Days, hours, minutes in little glowing squares on a sunset gradient — the render property is the component, serialised Chakra head to toe. Point the fields at any date worth counting to.',
    fields: [
      { name: 'eventName', type: 'string', required: true, maxLength: 80 },
      { name: 'targetDate', type: 'date', required: true },
      { name: 'vibe', type: 'enum', values: ['excited', 'nervous', 'patient'] }
    ],
    render: {
      type: 'chakra',
      chakra: 'Card',
      props: { bgGradient: 'linear(to-r, orange.400, pink.500)', color: 'white', maxW: '360px', borderRadius: '2xl' },
      children: [
        {
          chakra: 'CardBody',
          children: [
            {
              chakra: 'VStack',
              props: { spacing: 4 },
              children: [
                { chakra: 'Heading', props: { size: 'md' }, rawChildren: ['Seed Swap Saturday 🌻'] },
                {
                  chakra: 'HStack',
                  props: { spacing: 3 },
                  children: [
                    {
                      chakra: 'VStack',
                      props: { spacing: 1 },
                      children: [
                        {
                          chakra: 'Square',
                          props: { size: '56px', bg: 'whiteAlpha.300', borderRadius: 'lg' },
                          children: [{ chakra: 'Text', props: { fontSize: '2xl', fontWeight: 'bold' }, rawChildren: ['03'] }]
                        },
                        { chakra: 'Text', props: { fontSize: 'xs' }, rawChildren: ['days'] }
                      ]
                    },
                    {
                      chakra: 'VStack',
                      props: { spacing: 1 },
                      children: [
                        {
                          chakra: 'Square',
                          props: { size: '56px', bg: 'whiteAlpha.300', borderRadius: 'lg' },
                          children: [{ chakra: 'Text', props: { fontSize: '2xl', fontWeight: 'bold' }, rawChildren: ['11'] }]
                        },
                        { chakra: 'Text', props: { fontSize: 'xs' }, rawChildren: ['hours'] }
                      ]
                    },
                    {
                      chakra: 'VStack',
                      props: { spacing: 1 },
                      children: [
                        {
                          chakra: 'Square',
                          props: { size: '56px', bg: 'whiteAlpha.300', borderRadius: 'lg' },
                          children: [{ chakra: 'Text', props: { fontSize: '2xl', fontWeight: 'bold' }, rawChildren: ['42'] }]
                        },
                        { chakra: 'Text', props: { fontSize: 'xs' }, rawChildren: ['mins'] }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'countdown'],
    ageHours: 138
  },
  {
    slug: 'music-player-card',
    owner: 'sunny.raye',
    name: 'Music Player Card',
    description:
      'Now playing, as data 🎧 Album art square, track and artist, a progress bar mid-song, and transport buttons — the render tree is the player itself, JSON drawn through the Chakra allowlist. The buttons are honest: they are data too.',
    fields: [
      { name: 'track', type: 'string', required: true },
      { name: 'artist', type: 'string' },
      { name: 'album', type: 'string' },
      { name: 'durationSeconds', type: 'number', min: 0, unit: 's' },
      { name: 'progress', type: 'number', min: 0, max: 100, unit: '%' }
    ],
    render: {
      type: 'chakra',
      chakra: 'Card',
      props: { bg: 'gray.900', color: 'white', maxW: '340px', borderRadius: '2xl' },
      children: [
        {
          chakra: 'CardBody',
          children: [
            {
              chakra: 'VStack',
              props: { alignItems: 'stretch', spacing: 4 },
              children: [
                {
                  chakra: 'HStack',
                  props: { spacing: 4 },
                  children: [
                    {
                      chakra: 'Square',
                      props: { size: '64px', borderRadius: 'lg', bgGradient: 'linear(to-br, purple.500, pink.400)' },
                      children: [{ chakra: 'Text', props: { fontSize: '2xl' }, rawChildren: ['🎧'] }]
                    },
                    {
                      chakra: 'VStack',
                      props: { alignItems: 'flex-start', spacing: 0 },
                      children: [
                        { chakra: 'Text', props: { fontWeight: 'bold' }, rawChildren: ['Photosynthesis'] },
                        { chakra: 'Text', props: { fontSize: 'sm', color: 'gray.400' }, rawChildren: ['The Chlorophylls'] }
                      ]
                    }
                  ]
                },
                { chakra: 'Progress', props: { value: 42, size: 'xs', colorScheme: 'pink', borderRadius: 'full' } },
                {
                  chakra: 'HStack',
                  props: { justifyContent: 'center', spacing: 6 },
                  children: [
                    { chakra: 'Button', props: { variant: 'ghost', color: 'white' }, rawChildren: ['⏮'] },
                    { chakra: 'Button', props: { borderRadius: 'full', colorScheme: 'pink' }, rawChildren: ['▶'] },
                    { chakra: 'Button', props: { variant: 'ghost', color: 'white' }, rawChildren: ['⏭'] }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'music'],
    ageHours: 156
  },
  {
    slug: 'rainbow-welcome-card',
    owner: 'moss.gardener',
    name: 'Rainbow Welcome Card',
    description:
      'The official Thingtime hug 🌈 A rainbow gradient frame around a warm hello — and the render property is not a mockup, it IS the component, serialised Chakra stored in Mongo like any other thing. Change the fields, keep the rainbow.',
    fields: [
      { name: 'name', type: 'string', required: true, maxLength: 60 },
      { name: 'message', type: 'string', maxLength: 200 }
    ],
    render: {
      type: 'chakra',
      chakra: 'Box',
      props: {
        bgGradient: 'linear(to-r, red.400, orange.400, yellow.400, green.400, blue.400, purple.400)',
        p: '4px',
        borderRadius: '2xl',
        maxW: '360px'
      },
      children: [
        {
          chakra: 'Box',
          props: { bg: 'white', borderRadius: 'xl', p: 8, textAlign: 'center' },
          children: [
            { chakra: 'Heading', props: { size: 'md' }, rawChildren: ['Welcome to Thingtime 🌈'] },
            {
              chakra: 'Text',
              props: { mt: 3, fontSize: 'sm', color: 'gray.600' },
              rawChildren: ['Everything is a thing, and every thing can bloom. Even this card. Especially this card.']
            }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'welcome'],
    extended: { palette: ['red.400', 'orange.400', 'yellow.400', 'green.400', 'blue.400', 'purple.400'] },
    ageHours: 180
  },
  {
    slug: 'product-spotlight',
    owner: 'vintage.vera',
    name: 'Product Spotlight',
    description:
      'One product, centre stage 🛍️ Photo up top, NEW badge, tagline, price, and an add-to-cart button — the render tree is the storefront card itself, drawn live from JSON. Vera uses it for heirlooms; you can use it for anything.',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'price', type: 'number', min: 0 },
      { name: 'currency', type: 'string', maxLength: 5 },
      { name: 'tagline', type: 'string', maxLength: 120 },
      { name: 'imageUrl', type: 'string' },
      { name: 'inStock', type: 'boolean' }
    ],
    render: {
      type: 'chakra',
      chakra: 'Card',
      props: { maxW: '300px', overflow: 'hidden', borderRadius: '2xl', boxShadow: 'lg' },
      children: [
        {
          chakra: 'Image',
          props: { src: 'https://picsum.photos/seed/copper-can/600/320', alt: 'Copper heirloom watering can', height: '160px', objectFit: 'cover' }
        },
        {
          chakra: 'CardBody',
          children: [
            {
              chakra: 'VStack',
              props: { alignItems: 'flex-start', spacing: 2 },
              children: [
                { chakra: 'Badge', props: { colorScheme: 'pink', borderRadius: 'full' }, rawChildren: ['NEW'] },
                { chakra: 'Heading', props: { size: 'md' }, rawChildren: ['Copper heirloom can'] },
                { chakra: 'Text', props: { fontSize: 'sm', color: 'gray.500' }, rawChildren: ['Waters plants and looks smug about it.'] },
                {
                  chakra: 'HStack',
                  props: { width: '100%', mt: 2 },
                  children: [
                    { chakra: 'Text', props: { fontWeight: 'bold', fontSize: 'xl' }, rawChildren: ['$89'] },
                    { chakra: 'Spacer' },
                    { chakra: 'Button', props: { size: 'sm', colorScheme: 'teal', borderRadius: 'full' }, rawChildren: ['Add to cart'] }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'commerce'],
    ageHours: 210
  },
  {
    slug: 'team-roster-card',
    owner: 'coach.leo',
    name: 'Team Roster Card',
    description:
      'The squad sheet, pinned to the fridge 📋 A real Chakra Table inside a card — header row, positions, shirt numbers — all serialised in the render property and drawn through the allowlist. Fields hold the roster data.',
    fields: [
      { name: 'teamName', type: 'string', required: true },
      { name: 'season', type: 'string', maxLength: 20 },
      {
        name: 'players',
        type: 'array',
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          children: [
            { name: 'name', type: 'string', required: true },
            { name: 'position', type: 'string', maxLength: 30 },
            { name: 'number', type: 'number', min: 0, max: 99 }
          ]
        }
      }
    ],
    render: {
      type: 'chakra',
      chakra: 'Card',
      props: { maxW: '420px', borderRadius: 'xl' },
      children: [
        {
          chakra: 'CardHeader',
          children: [{ chakra: 'Heading', props: { size: 'md' }, rawChildren: ['Ferns FC — 2026 🌿'] }]
        },
        {
          chakra: 'CardBody',
          props: { pt: 0 },
          children: [
            {
              chakra: 'TableContainer',
              children: [
                {
                  chakra: 'Table',
                  props: { size: 'sm', variant: 'simple' },
                  children: [
                    {
                      chakra: 'Thead',
                      children: [
                        {
                          chakra: 'Tr',
                          children: [
                            { chakra: 'Th', rawChildren: ['Player'] },
                            { chakra: 'Th', rawChildren: ['Position'] },
                            { chakra: 'Th', rawChildren: ['#'] }
                          ]
                        }
                      ]
                    },
                    {
                      chakra: 'Tbody',
                      children: [
                        {
                          chakra: 'Tr',
                          children: [
                            { chakra: 'Td', rawChildren: ['Mika Fern'] },
                            { chakra: 'Td', rawChildren: ['Striker'] },
                            { chakra: 'Td', rawChildren: ['9'] }
                          ]
                        },
                        {
                          chakra: 'Tr',
                          children: [
                            { chakra: 'Td', rawChildren: ['Sol Bloom'] },
                            { chakra: 'Td', rawChildren: ['Keeper'] },
                            { chakra: 'Td', rawChildren: ['1'] }
                          ]
                        },
                        {
                          chakra: 'Tr',
                          children: [
                            { chakra: 'Td', rawChildren: ['Fern Whitlock'] },
                            { chakra: 'Td', rawChildren: ['Midfield'] },
                            { chakra: 'Td', rawChildren: ['8'] }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'sport'],
    ageHours: 260
  },
  {
    slug: 'quote-poster',
    owner: 'vintage.vera',
    name: 'Quote Poster',
    description:
      'Big words on a dark sky 🌌 An element-shaped render — a section, a blockquote, a byline — proving a poster can be nothing but tags, props, and children stored in Mongo. Swap the fields, reprint the poster.',
    fields: [
      { name: 'quote', type: 'string', required: true, maxLength: 300 },
      { name: 'attribution', type: 'string', maxLength: 80 }
    ],
    render: {
      tag: 'section',
      props: {
        style: {
          padding: '48px 32px',
          borderRadius: '24px',
          background: 'linear-gradient(160deg, #1a1a2e 0%, #16213e 100%)',
          color: '#ffffff',
          textAlign: 'center'
        }
      },
      children: [
        {
          tag: 'blockquote',
          props: { style: { margin: 0, fontSize: '26px', fontStyle: 'italic', lineHeight: 1.4 } },
          children: ['“The best time to plant a tree was 20 years ago. The second best time is a thing.”']
        },
        {
          tag: 'p',
          props: { style: { marginTop: '18px', fontSize: '14px', color: '#9aa5ce' } },
          children: ['— Vintage Vera, embroidering it as we speak']
        }
      ]
    },
    tags: ['render', 'element', 'quote'],
    ageHours: 320
  },
  {
    slug: 'metric-row',
    owner: 'rick.deckard',
    name: 'Metric Row',
    description:
      'Three numbers walking abreast 📊 A Chakra StatGroup with arrows up and down — the render property is the component itself, ready to sit at the top of any page that needs a pulse. Fields carry the metrics behind the row.',
    fields: [
      {
        name: 'metrics',
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          children: [
            { name: 'label', type: 'string', required: true },
            { name: 'value', type: 'string', required: true },
            { name: 'change', type: 'number', unit: '%' }
          ]
        }
      }
    ],
    render: {
      type: 'chakra',
      chakra: 'Card',
      props: { borderRadius: 'xl', maxW: '520px' },
      children: [
        {
          chakra: 'CardBody',
          children: [
            {
              chakra: 'StatGroup',
              props: { gap: 6 },
              children: [
                {
                  chakra: 'Stat',
                  children: [
                    { chakra: 'StatLabel', rawChildren: ['Things'] },
                    { chakra: 'StatNumber', rawChildren: ['482'] },
                    { chakra: 'StatHelpText', children: [{ chakra: 'StatArrow', props: { type: 'increase' } }, '12%'] }
                  ]
                },
                {
                  chakra: 'Stat',
                  children: [
                    { chakra: 'StatLabel', rawChildren: ['Friends'] },
                    { chakra: 'StatNumber', rawChildren: ['57'] },
                    { chakra: 'StatHelpText', children: [{ chakra: 'StatArrow', props: { type: 'increase' } }, '4%'] }
                  ]
                },
                {
                  chakra: 'Stat',
                  children: [
                    { chakra: 'StatLabel', rawChildren: ['Weeds'] },
                    { chakra: 'StatNumber', rawChildren: ['3'] },
                    { chakra: 'StatHelpText', children: [{ chakra: 'StatArrow', props: { type: 'decrease' } }, '60%'] }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    tags: ['render', 'chakra', 'metrics'],
    ageHours: 400
  }
];
