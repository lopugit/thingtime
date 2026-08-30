// Deterministic auto-icons for /things. The ordered file rules are the single
// source of truth: specific semantic hints (a screenshot filename) must beat a
// broad type hint (image/png), then unknown files fall back to a floppy disk.

export type ThingIconInput = {
  thingtime: readonly string[];
  crystal?: Record<string, unknown> | null;
};

export type FileIconRule = {
  id: string;
  icon: string;
  thingKinds?: readonly string[];
  filenamePatterns?: readonly RegExp[];
  extensions?: readonly string[];
  mimeTypes?: readonly string[];
  mimePrefixes?: readonly string[];
};

export const THING_KIND_ICONS: Readonly<Record<string, string>> = {
  folder: '📁',
  post: '📝',
  comment: '💬',
  reaction: '😊',
  share: '🔁',
  save: '🔖',
  data: '📦',
  schema: '💎',
  component: '🧩',
  action: '⚡',
  'action-run': '🧾',
  attachment: '💾',
  file: '💾',
  download: '💾',
  document: '📄',
  image: '🏞️',
  photo: '🏞️',
  screenshot: '🖼️',
  video: '🎬',
  audio: '🎵',
  code: '💻',
  link: '🔗',
  bookmark: '🔖',
  chat: '💬',
  'chat-message': '🗨️',
  'chat-member': '👤',
  'chat-section': '🗂️',
  community: '🏘️',
  'community-member': '🫂',
  'community-invite': '✉️',
  'custom-emoji': '😀',
  follow: '👣',
  user: '👤',
  theme: '🎨',
  'feed-algorithm': '🧠',
  waitlist: '⏳',
  app: '🧩',
  'app-data': '🗃️'
};

// Ordered from most specific to most general. Keep screenshot ahead of image:
// both are commonly PNG/JPEG, but the filename tells us the more useful icon.
export const FILE_TYPE_ICON_RULES: readonly FileIconRule[] = [
  {
    id: 'screenshot',
    icon: '🖼️',
    thingKinds: ['screenshot', 'screen-capture'],
    filenamePatterns: [/(?:^|[\s._-])screen[\s._-]?shot(?:[\s._-]|$)/i, /(?:^|[\s._-])screenshot(?:[\s._-]|$)/i, /(?:^|[\s._-])screen[\s._-]?capture(?:[\s._-]|$)/i, /(?:^|[\s._-])screencap(?:ture)?(?:[\s._-]|$)/i, /(?:^|[\s._-])snipping[\s._-]?tool(?:[\s._-]|$)/i]
  },
  {
    id: 'image',
    icon: '🏞️',
    thingKinds: ['image', 'photo'],
    extensions: ['avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jpeg', 'jpg', 'jxl', 'png', 'svg', 'tif', 'tiff', 'webp'],
    mimePrefixes: ['image/']
  },
  {
    id: 'video',
    icon: '🎬',
    thingKinds: ['video', 'movie'],
    extensions: ['3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm'],
    mimePrefixes: ['video/']
  },
  {
    id: 'audio',
    icon: '🎵',
    thingKinds: ['audio', 'music', 'podcast'],
    extensions: ['aac', 'aiff', 'alac', 'flac', 'm4a', 'mid', 'midi', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'wma'],
    mimePrefixes: ['audio/']
  },
  {
    id: 'pdf',
    icon: '📕',
    extensions: ['pdf'],
    mimeTypes: ['application/pdf']
  },
  {
    id: 'presentation',
    icon: '📽️',
    extensions: ['key', 'odp', 'ppt', 'pptx'],
    mimeTypes: ['application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
  },
  {
    id: 'spreadsheet',
    icon: '📊',
    extensions: ['csv', 'numbers', 'ods', 'tsv', 'xls', 'xlsb', 'xlsm', 'xlsx'],
    mimeTypes: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv']
  },
  {
    id: 'document',
    icon: '📄',
    thingKinds: ['document'],
    extensions: ['doc', 'docx', 'log', 'md', 'odt', 'pages', 'rtf', 'tex', 'txt'],
    mimePrefixes: ['text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml']
  },
  {
    id: 'ebook',
    icon: '📚',
    extensions: ['azw', 'azw3', 'epub', 'mobi'],
    mimeTypes: ['application/epub+zip']
  },
  {
    id: 'archive',
    icon: '🗜️',
    extensions: ['7z', 'bz2', 'gz', 'rar', 'tar', 'tar.bz2', 'tar.gz', 'tgz', 'xz', 'zip'],
    mimeTypes: ['application/gzip', 'application/vnd.rar', 'application/x-7z-compressed', 'application/x-tar', 'application/zip']
  },
  {
    id: 'disk-image',
    icon: '💿',
    extensions: ['dmg', 'img', 'iso'],
    mimeTypes: ['application/x-apple-diskimage', 'application/x-iso9660-image']
  },
  {
    id: 'installer',
    icon: '📦',
    extensions: ['apk', 'appimage', 'deb', 'exe', 'ipa', 'jar', 'msi', 'pkg', 'rpm']
  },
  {
    id: 'font',
    icon: '🔤',
    extensions: ['eot', 'otf', 'ttc', 'ttf', 'woff', 'woff2'],
    mimePrefixes: ['font/']
  },
  {
    id: 'code',
    icon: '💻',
    thingKinds: ['code'],
    extensions: ['astro', 'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'jsx', 'kt', 'kts', 'lua', 'm', 'mm', 'php', 'pl', 'py', 'rb', 'rs', 'scss', 'sh', 'sql', 'swift', 'ts', 'tsx', 'vue', 'wasm']
  },
  {
    id: 'data',
    icon: '🗃️',
    extensions: ['db', 'geojson', 'json', 'jsonl', 'ndjson', 'parquet', 'sqlite', 'toml', 'xml', 'yaml', 'yml'],
    mimeTypes: ['application/json', 'application/ld+json', 'application/xml', 'text/xml']
  },
  {
    id: 'model',
    icon: '🧊',
    extensions: ['3mf', 'blend', 'dae', 'fbx', 'gltf', 'glb', 'obj', 'scad', 'stl', 'usd', 'usdz']
  },
  {
    id: 'calendar',
    icon: '📅',
    extensions: ['ics'],
    mimeTypes: ['text/calendar']
  },
  {
    id: 'contact',
    icon: '📇',
    extensions: ['vcf'],
    mimeTypes: ['text/vcard']
  },
  {
    id: 'email',
    icon: '✉️',
    extensions: ['eml', 'msg'],
    mimeTypes: ['message/rfc822']
  },
  {
    id: 'torrent',
    icon: '🧲',
    extensions: ['torrent'],
    mimeTypes: ['application/x-bittorrent']
  },
  {
    id: 'secure',
    icon: '🔐',
    extensions: ['asc', 'cer', 'crt', 'gpg', 'key', 'p12', 'pem', 'sig']
  }
] as const;

const PRIMARY_KIND_ORDER = ['folder', 'attachment', 'file', 'share', 'comment', 'reaction', 'save', 'schema', 'data', 'post'];
const FILE_LIKE_KINDS = new Set([
  'attachment',
  'download',
  'file',
  'document',
  'image',
  'photo',
  'screenshot',
  'screen-capture',
  'video',
  'movie',
  'audio',
  'music',
  'podcast',
  'code'
]);

export const primaryKindOf = (thing: Pick<ThingIconInput, 'thingtime'>): string =>
  PRIMARY_KIND_ORDER.find((kind) => thing.thingtime.includes(kind)) || thing.thingtime[0] || 'data';

const firstString = (crystal: Record<string, unknown>, keys: readonly string[]): string => {
  for (const key of keys) {
    const value = crystal[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const fileFacts = (thing: ThingIconInput) => {
  const crystal = thing.crystal || {};
  const name = firstString(crystal, ['filename', 'fileName', 'originalName', 'name', 'title']);
  const declaredType = firstString(crystal, ['mimeType', 'contentType', 'mime', 'type']).toLowerCase();
  const mimeType = declaredType.includes('/') ? declaredType.split(';', 1)[0].trim() : '';
  const cleanName = name.toLowerCase().split(/[?#]/, 1)[0];
  const basename = cleanName.split(/[\\/]/).pop() || '';
  const parts = basename.split('.').filter(Boolean);
  const extensions = new Set<string>();
  if (parts.length > 1) extensions.add(parts.at(-1) || '');
  if (parts.length > 2) extensions.add(parts.slice(-2).join('.'));
  const explicitExtension = firstString(crystal, ['extension']).replace(/^\./, '').toLowerCase();
  if (explicitExtension) extensions.add(explicitExtension);
  if (declaredType && !declaredType.includes('/')) extensions.add(declaredType.replace(/^\./, ''));
  extensions.delete('');
  return { kind: primaryKindOf(thing), name, mimeType, extensions };
};

export const fileIconForThing = (thing: ThingIconInput): string => {
  const facts = fileFacts(thing);
  for (const rule of FILE_TYPE_ICON_RULES) {
    if (rule.thingKinds?.includes(facts.kind)) return rule.icon;
    if (rule.filenamePatterns?.some((pattern) => pattern.test(facts.name))) return rule.icon;
    if (rule.mimeTypes?.includes(facts.mimeType)) return rule.icon;
    if (rule.mimePrefixes?.some((prefix) => facts.mimeType.startsWith(prefix))) return rule.icon;
    if (rule.extensions?.some((extension) => facts.extensions.has(extension))) return rule.icon;
  }
  return '💾';
};

const hasFileSignals = (thing: ThingIconInput): boolean => {
  const crystal = thing.crystal || {};
  const hasFileName = Boolean(firstString(crystal, ['filename', 'fileName', 'originalName']));
  const hasNamedFileShape = Boolean(firstString(crystal, ['name'])) && ['size', 'type', 'mimeType', 'contentType'].some((key) => key in crystal);
  return hasFileName || hasNamedFileShape;
};

export const thingIcon = (thing: ThingIconInput): string => {
  const kind = primaryKindOf(thing);
  if (kind === 'folder' && typeof thing.crystal?.icon === 'string' && thing.crystal.icon) return thing.crystal.icon;
  if (FILE_LIKE_KINDS.has(kind) || hasFileSignals(thing)) return fileIconForThing(thing);
  return THING_KIND_ICONS[kind] || '🌀';
};
