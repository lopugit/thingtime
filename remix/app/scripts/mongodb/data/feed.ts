// Seed feed data — demo users, profiles, and posts of every feed type, all
// created through the REAL utils the API routes call (FUNDAMENTALS.md §2).
// Post shareIds are fixed so re-seeding skips idempotently; reactions and
// comments are only applied to posts created in the same run.

import type { SeedUser } from './users';

export type SeedProfile = {
  username: string;
  bio: string;
  avatarUrl: string;
  bannerUrl: string;
};

export type SeedPost = {
  shareId: string;
  username: string;
  type: 'text' | 'image' | 'marketplace';
  text?: string;
  images?: string[];
  listing?: {
    title: string;
    price: number;
    currency?: string;
    category: 'car' | 'tool' | 'furniture' | 'service' | 'other';
    condition?: 'new' | 'used';
    location?: string;
    sold?: boolean;
  };
  visibility?: 'public' | 'friends' | 'family' | 'private';
  tags?: string[];
  ageHours: number;
};

export type SeedReaction = { postShareId: string; username: string; emoji: string };
export type SeedComment = { postShareId: string; username: string; text: string };
export type SeedAlgorithm = {
  username: string;
  name: string;
  emoji: string;
  // trained from these seed posts' engagement (share signal strength)
  trainOnShareIds: string[];
};

const img = (seed: string, w = 900, h = 600) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const avatar = (n: number) => `https://i.pravatar.cc/150?img=${n}`;

export const getFeedUsers = async (): Promise<SeedUser[]> => [
  { username: 'moss.gardener', password: 'password', email: 'moss.gardener@thingtime.com', displayName: 'Maple Moss' },
  { username: 'sunny.raye', password: 'password', email: 'sunny.raye@thingtime.com', displayName: 'Sunny Raye' },
  { username: 'gary.tinfoil', password: 'password', email: 'gary.tinfoil@thingtime.com', displayName: 'Gary T.' },
  { username: 'toolshed.tom', password: 'password', email: 'toolshed.tom@thingtime.com', displayName: 'Tom Wrenchman' },
  { username: 'vintage.vera', password: 'password', email: 'vintage.vera@thingtime.com', displayName: 'Vera Velvet' },
  { username: 'coach.leo', password: 'password', email: 'coach.leo@thingtime.com', displayName: 'Leo the Local' }
];

export const getProfiles = async (): Promise<SeedProfile[]> => [
  {
    username: 'rick.deckard',
    bio: 'Blade runner, retired (mostly). I photograph rainy streets and argue with my toaster.',
    avatarUrl: avatar(12),
    bannerUrl: img('deckard-banner', 1200, 400)
  },
  {
    username: 'rachael',
    bio: 'More human than human. Piano, memory, and long walks through the archive.',
    avatarUrl: avatar(47),
    bannerUrl: img('rachael-banner', 1200, 400)
  },
  {
    username: 'moss.gardener',
    bio: 'Building a tiny house brick by brick 🧱 Garden updates hourly. Ask me about compost.',
    avatarUrl: avatar(32),
    bannerUrl: img('moss-banner', 1200, 400)
  },
  {
    username: 'sunny.raye',
    bio: 'Your friendly neighbourhood news gremlin ☀️ If it happened today, I have a take.',
    avatarUrl: avatar(24),
    bannerUrl: img('sunny-banner', 1200, 400)
  },
  {
    username: 'gary.tinfoil',
    bio: 'Just asking questions 👁️ The pigeons know more than they let on.',
    avatarUrl: avatar(59),
    bannerUrl: img('gary-banner', 1200, 400)
  },
  {
    username: 'toolshed.tom',
    bio: 'If it has an engine or a handle, I have probably sold one. Honest prices, oily hands.',
    avatarUrl: avatar(53),
    bannerUrl: img('tom-banner', 1200, 400)
  },
  {
    username: 'vintage.vera',
    bio: 'Rescuing mid-century furniture from garages since 2019 🛋️ Everything has a story.',
    avatarUrl: avatar(45),
    bannerUrl: img('vera-banner', 1200, 400)
  },
  {
    username: 'coach.leo',
    bio: 'Local legend for hire — lawns, lessons, and light removals. Five stars, one van.',
    avatarUrl: avatar(68),
    bannerUrl: img('leo-banner', 1200, 400)
  }
];

export const getPosts = async (): Promise<SeedPost[]> => [
  // ——— builder / DIY thread (tags: diy, build)
  {
    shareId: 'seed-post-001',
    username: 'moss.gardener',
    type: 'text',
    text: 'Day 47 of the tiny house build. Today I laid the last brick of the north wall. I have named every brick. This one is Barry. 🧱',
    tags: ['diy', 'build', 'tinyhouse'],
    ageHours: 2
  },
  {
    shareId: 'seed-post-002',
    username: 'moss.gardener',
    type: 'image',
    text: 'North wall DONE. Barry is the third from the left, second row. He carried the team.',
    images: [img('brick-wall-1'), img('brick-wall-2')],
    tags: ['diy', 'build', 'tinyhouse'],
    ageHours: 26
  },
  {
    shareId: 'seed-post-003',
    username: 'moss.gardener',
    type: 'image',
    text: 'Garden update: the pumpkin has opinions now.',
    images: [img('pumpkin-patch')],
    tags: ['garden', 'diy'],
    ageHours: 50
  },
  // ——— news-y posts (tags: news)
  {
    shareId: 'seed-post-004',
    username: 'sunny.raye',
    type: 'text',
    text: 'BREAKING: Local council votes 6-1 to keep the giant rubber duck in the fountain "indefinitely". The one dissenter reportedly "fears the duck". More at 6.',
    tags: ['news', 'local'],
    ageHours: 4
  },
  {
    shareId: 'seed-post-005',
    username: 'sunny.raye',
    type: 'text',
    text: 'Markets today: up, then down, then sideways, then the analyst on channel 4 shrugged live on air. Honestly? Same.',
    tags: ['news', 'finance'],
    ageHours: 20
  },
  {
    shareId: 'seed-post-006',
    username: 'sunny.raye',
    type: 'image',
    text: 'Photo from this morning\'s fog. The bridge simply refused to exist before 9am.',
    images: [img('foggy-bridge', 1000, 650)],
    tags: ['news', 'weather', 'photography'],
    ageHours: 9
  },
  // ——— conspiracy-lite (tags: conspiracy)
  {
    shareId: 'seed-post-007',
    username: 'gary.tinfoil',
    type: 'text',
    text: 'Nobody talks about how the moon is only ever seen at NIGHT or sometimes DAY. Convenient scheduling if you ask me. Just asking questions. 👁️',
    tags: ['conspiracy', 'moon'],
    ageHours: 6
  },
  {
    shareId: 'seed-post-008',
    username: 'gary.tinfoil',
    type: 'text',
    text: 'Update: followed a pigeon for three blocks today. It knew. It absolutely knew. Thread incoming once I decrypt its coo pattern.',
    tags: ['conspiracy', 'birds'],
    ageHours: 30
  },
  {
    shareId: 'seed-post-009',
    username: 'gary.tinfoil',
    type: 'image',
    text: 'You cannot tell me this cloud is not a surveillance blimp. Wake up sheeple (respectfully).',
    images: [img('suspicious-cloud', 1000, 700)],
    tags: ['conspiracy', 'weather'],
    ageHours: 55
  },
  // ——— marketplace: cars
  {
    shareId: 'seed-post-010',
    username: 'toolshed.tom',
    type: 'marketplace',
    text: 'Selling the old girl. Starts first try on warm days, second try on principle.',
    images: [img('old-ute', 1000, 700), img('old-ute-2', 1000, 700)],
    listing: {
      title: '1987 Ford Falcon ute — runs great, character included',
      price: 4800,
      currency: 'AUD',
      category: 'car',
      condition: 'used',
      location: 'Byron Bay'
    },
    tags: ['cars'],
    ageHours: 12
  },
  {
    shareId: 'seed-post-011',
    username: 'toolshed.tom',
    type: 'marketplace',
    text: 'Wife says the shed is "structurally more drill than shed" now. Her loss.',
    images: [img('drill-set', 900, 700)],
    listing: {
      title: 'Makita 18V drill + 3 batteries + questionable case',
      price: 220,
      currency: 'AUD',
      category: 'tool',
      condition: 'used',
      location: 'Byron Bay'
    },
    tags: ['tools'],
    ageHours: 28
  },
  {
    shareId: 'seed-post-012',
    username: 'toolshed.tom',
    type: 'marketplace',
    images: [img('angle-grinder', 900, 700)],
    listing: {
      title: 'Angle grinder, brand new, won in a raffle I don\'t remember entering',
      price: 95,
      currency: 'AUD',
      category: 'tool',
      condition: 'new',
      location: 'Mullumbimby'
    },
    tags: ['tools'],
    ageHours: 70
  },
  // ——— marketplace: furniture
  {
    shareId: 'seed-post-013',
    username: 'vintage.vera',
    type: 'marketplace',
    text: 'This armchair has heard more secrets than a hairdresser. Reupholstered in emerald velvet.',
    images: [img('velvet-armchair', 900, 800)],
    listing: {
      title: 'Mid-century armchair, emerald velvet, extremely wise',
      price: 340,
      currency: 'AUD',
      category: 'furniture',
      condition: 'used',
      location: 'Bangalow'
    },
    tags: ['furniture', 'vintage'],
    ageHours: 8
  },
  {
    shareId: 'seed-post-014',
    username: 'vintage.vera',
    type: 'marketplace',
    images: [img('teak-sideboard', 1000, 700)],
    listing: {
      title: 'Teak sideboard, 1960s, fits exactly 74 records (tested)',
      price: 520,
      currency: 'AUD',
      category: 'furniture',
      condition: 'used',
      location: 'Bangalow'
    },
    tags: ['furniture', 'vintage'],
    ageHours: 46
  },
  {
    shareId: 'seed-post-015',
    username: 'vintage.vera',
    type: 'image',
    text: 'Before/after on the rescued dresser. She just needed someone to believe in her (and 4 litres of stripper).',
    images: [img('dresser-before', 800, 600), img('dresser-after', 800, 600)],
    tags: ['furniture', 'vintage', 'diy'],
    ageHours: 33
  },
  // ——— marketplace: services
  {
    shareId: 'seed-post-016',
    username: 'coach.leo',
    type: 'marketplace',
    text: 'Spring special! Lawns mowed, edges edged, one (1) free fun fact about your grass per visit.',
    listing: {
      title: 'Lawn mowing & garden tidy — Leo\'s Legendary Lawns',
      price: 60,
      currency: 'AUD',
      category: 'service',
      location: 'Byron Shire'
    },
    tags: ['services', 'garden'],
    ageHours: 16
  },
  {
    shareId: 'seed-post-017',
    username: 'coach.leo',
    type: 'marketplace',
    listing: {
      title: 'Beginner surf lessons — patient coach, warm wetsuits, zero judgement',
      price: 45,
      currency: 'AUD',
      category: 'service',
      location: 'Byron Bay Main Beach'
    },
    tags: ['services', 'surf'],
    ageHours: 40
  },
  // ——— classic social posts
  {
    shareId: 'seed-post-018',
    username: 'rick.deckard',
    type: 'image',
    text: 'Rain again. The noodle bar was out of noodles. Some days the city just wins.',
    images: [img('rainy-street', 1000, 700)],
    tags: ['photography', 'city'],
    ageHours: 5
  },
  {
    shareId: 'seed-post-019',
    username: 'rachael',
    type: 'text',
    text: 'Played piano for an hour without checking whether the memory of learning it was mine. Growth. 🎹',
    tags: ['music', 'life'],
    ageHours: 14
  },
  {
    shareId: 'seed-post-020',
    username: 'rick.deckard',
    type: 'text',
    text: 'Hot take: electric sheep are fine but have you tried an electric blanket?',
    tags: ['life'],
    ageHours: 60
  },
  {
    shareId: 'seed-post-021',
    username: 'rachael',
    type: 'image',
    text: 'Morning light in the archive. Some photographs deserve to be real.',
    images: [img('archive-light', 900, 650)],
    tags: ['photography', 'life'],
    ageHours: 37
  },
  // ——— a friends-circle post so circle filtering has something to show (owner-only for now)
  {
    shareId: 'seed-post-022',
    username: 'rick.deckard',
    type: 'text',
    text: 'Friends only: thinking about adopting a real dog. A REAL one. Don\'t tell the department.',
    visibility: 'friends',
    tags: ['life'],
    ageHours: 3
  },
  {
    shareId: 'seed-post-023',
    username: 'moss.gardener',
    type: 'marketplace',
    text: 'Leftover from the build — 200 bricks, none of them named, all of them lovely.',
    images: [img('brick-pile', 900, 600)],
    listing: {
      title: '200 recycled red bricks — free to a good wall',
      price: 0,
      currency: 'AUD',
      category: 'other',
      condition: 'used',
      location: 'Federal'
    },
    tags: ['diy', 'build'],
    ageHours: 18
  },
  {
    shareId: 'seed-post-024',
    username: 'sunny.raye',
    type: 'text',
    text: 'EXCLUSIVE: The rubber duck has been fitted with a tiny hat by persons unknown. The council is "aware and delighted". Developing story.',
    tags: ['news', 'local'],
    ageHours: 1
  }
];

export const getReactions = async (): Promise<SeedReaction[]> => [
  { postShareId: 'seed-post-001', username: 'toolshed.tom', emoji: '👍' },
  { postShareId: 'seed-post-001', username: 'vintage.vera', emoji: '❤️' },
  { postShareId: 'seed-post-001', username: 'gary.tinfoil', emoji: '😮' },
  { postShareId: 'seed-post-002', username: 'rick.deckard', emoji: '👍' },
  { postShareId: 'seed-post-002', username: 'coach.leo', emoji: '❤️' },
  { postShareId: 'seed-post-004', username: 'gary.tinfoil', emoji: '😮' },
  { postShareId: 'seed-post-004', username: 'rachael', emoji: '😂' },
  { postShareId: 'seed-post-007', username: 'sunny.raye', emoji: '😂' },
  { postShareId: 'seed-post-007', username: 'moss.gardener', emoji: '😂' },
  { postShareId: 'seed-post-007', username: 'rick.deckard', emoji: '😮' },
  { postShareId: 'seed-post-010', username: 'coach.leo', emoji: '👍' },
  { postShareId: 'seed-post-013', username: 'rachael', emoji: '❤️' },
  { postShareId: 'seed-post-013', username: 'moss.gardener', emoji: '❤️' },
  { postShareId: 'seed-post-015', username: 'toolshed.tom', emoji: '👍' },
  { postShareId: 'seed-post-016', username: 'moss.gardener', emoji: '👍' },
  { postShareId: 'seed-post-018', username: 'rachael', emoji: '❤️' },
  { postShareId: 'seed-post-019', username: 'rick.deckard', emoji: '❤️' },
  { postShareId: 'seed-post-024', username: 'gary.tinfoil', emoji: '😡' }
];

export const getComments = async (): Promise<SeedComment[]> => [
  { postShareId: 'seed-post-001', username: 'toolshed.tom', text: 'Barry looks load-bearing. Good lad.' },
  { postShareId: 'seed-post-001', username: 'gary.tinfoil', text: 'Naming bricks is how they get you. Stay vigilant. Also congrats.' },
  { postShareId: 'seed-post-004', username: 'gary.tinfoil', text: 'The duck was never elected. Think about it.' },
  { postShareId: 'seed-post-004', username: 'vintage.vera', text: 'That duck has better tenure than most of us.' },
  { postShareId: 'seed-post-007', username: 'sunny.raye', text: 'Gary I am BEGGING you to come on the show.' },
  { postShareId: 'seed-post-010', username: 'moss.gardener', text: 'Does the character cost extra or is it included?' },
  { postShareId: 'seed-post-013', username: 'rachael', text: 'If the chair has heard secrets, I have questions for it.' },
  { postShareId: 'seed-post-016', username: 'toolshed.tom', text: 'Can confirm the grass facts are excellent. Life-changing, even.' },
  { postShareId: 'seed-post-018', username: 'rachael', text: 'The city never wins. It just leads on points.' },
  { postShareId: 'seed-post-024', username: 'moss.gardener', text: 'Justice for the hatless days. We move forward.' }
];

// Demo algorithms for rick.deckard so the feed dropdown shows the multi-
// algorithm story out of the box. Trained through the same trackEngagement
// path live doomscrolling uses.
export const getAlgorithms = async (): Promise<SeedAlgorithm[]> => [
  {
    username: 'rick.deckard',
    name: 'Brick by brick',
    emoji: '🧱',
    trainOnShareIds: ['seed-post-001', 'seed-post-002', 'seed-post-003', 'seed-post-015', 'seed-post-023']
  },
  {
    username: 'rick.deckard',
    name: 'Tinfoil times',
    emoji: '👁️',
    trainOnShareIds: ['seed-post-007', 'seed-post-008', 'seed-post-009', 'seed-post-004', 'seed-post-024']
  }
];
