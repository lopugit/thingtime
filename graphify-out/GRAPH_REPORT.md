# Graph Report - .  (2026-06-18)

## Corpus Check
- Large corpus: 350 files · ~536,777 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 920 nodes · 1637 edges · 78 communities (64 shown, 14 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.86)
- Token cost: 0 input · 224,166 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Raycast ImageFile Operations|Raycast Image/File Operations]]
- [[_COMMUNITY_Remix API Routes & Editor|Remix API Routes & Editor]]
- [[_COMMUNITY_Backend API Dependencies|Backend API Dependencies]]
- [[_COMMUNITY_Remix Frontend Dependencies|Remix Frontend Dependencies]]
- [[_COMMUNITY_Remix DevLint Dependencies|Remix Dev/Lint Dependencies]]
- [[_COMMUNITY_Raycast Manifest & Deps|Raycast Manifest & Deps]]
- [[_COMMUNITY_Raycast Image Generation & Filters|Raycast Image Generation & Filters]]
- [[_COMMUNITY_Smarts Babel Codegen|Smarts Babel Codegen]]
- [[_COMMUNITY_Remix Root & Session Setup|Remix Root & Session Setup]]
- [[_COMMUNITY_Thingtime TimelineTimemachine|Thingtime Timeline/Timemachine]]
- [[_COMMUNITY_Smarts Package Manifest|Smarts Package Manifest]]
- [[_COMMUNITY_GradientPath SVG Library|GradientPath SVG Library]]
- [[_COMMUNITY_Raw Result Display Components|Raw Result Display Components]]
- [[_COMMUNITY_TypeScript Config (A)|TypeScript Config (A)]]
- [[_COMMUNITY_TypeScript Config (B)|TypeScript Config (B)]]
- [[_COMMUNITY_Remix Layout & Nav Components|Remix Layout & Nav Components]]
- [[_COMMUNITY_Commander V1 & MagicInput|Commander V1 & MagicInput]]
- [[_COMMUNITY_Smarts Opts Manipulation|Smarts Opts Manipulation]]
- [[_COMMUNITY_Commander V2 & Hooks|Commander V2 & Hooks]]
- [[_COMMUNITY_TypeScript Config (C)|TypeScript Config (C)]]
- [[_COMMUNITY_Rainbow Text & Splash Demo|Rainbow Text & Splash Demo]]
- [[_COMMUNITY_Speed-test Package|Speed-test Package]]
- [[_COMMUNITY_Thingtime Context & Types|Thingtime Context & Types]]
- [[_COMMUNITY_Smarts Context & Scoping|Smarts Context & Scoping]]
- [[_COMMUNITY_Image Mod Extension Docs & Tools|Image Mod Extension Docs & Tools]]
- [[_COMMUNITY_Auth & Fetch Hooks|Auth & Fetch Hooks]]
- [[_COMMUNITY_Raycast Command Type Defs|Raycast Command Type Defs]]
- [[_COMMUNITY_Minimal Package Manifest|Minimal Package Manifest]]
- [[_COMMUNITY_Smarts Parser & Eval|Smarts Parser & Eval]]
- [[_COMMUNITY_Smart Path Access (getset)|Smart Path Access (get/set)]]
- [[_COMMUNITY_Reactive Navigation Components|Reactive Navigation Components]]
- [[_COMMUNITY_McDonalds Promo Banner (gs2)|McDonalds Promo Banner (gs2)]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_Smart Thing Access (getset)|Smart Thing Access (get/set)]]
- [[_COMMUNITY_Smarts Serialization|Smarts Serialization]]
- [[_COMMUNITY_Branding & Displacement Map|Branding & Displacement Map]]
- [[_COMMUNITY_Displacement Map Assets|Displacement Map Assets]]
- [[_COMMUNITY_Smarts Object CloneMerge|Smarts Object Clone/Merge]]
- [[_COMMUNITY_Thingtime Vision & Use Cases|Thingtime Vision & Use Cases]]
- [[_COMMUNITY_Server Entry (Socket.io)|Server Entry (Socket.io)]]
- [[_COMMUNITY_Branding Logo & QR Codes|Branding Logo & QR Codes]]
- [[_COMMUNITY_Safe Component|Safe Component]]
- [[_COMMUNITY_Deformation Map (deformmap)|Deformation Map (deformmap)]]
- [[_COMMUNITY_Grimace Shake Background (gbg)|Grimace Shake Background (gbg)]]
- [[_COMMUNITY_Remix Session Storage|Remix Session Storage]]
- [[_COMMUNITY_Pink Plus Icon (Group 100)|Pink Plus Icon (Group 100)]]
- [[_COMMUNITY_Add Icon (Group 99)|Add Icon (Group 99)]]
- [[_COMMUNITY_Vercel Build Config|Vercel Build Config]]
- [[_COMMUNITY_Global Type Declarations|Global Type Declarations]]
- [[_COMMUNITY_GH Logo (Purple Blobs)|GH Logo (Purple Blobs)]]
- [[_COMMUNITY_Web App Manifest|Web App Manifest]]
- [[_COMMUNITY_Edge Route Config|Edge Route Config]]
- [[_COMMUNITY_Remix Request Handler|Remix Request Handler]]
- [[_COMMUNITY_ESLint Extends Config|ESLint Extends Config]]
- [[_COMMUNITY_Favicon Imports & Deploy|Favicon Imports & Deploy]]
- [[_COMMUNITY_Vercel Deploy Script|Vercel Deploy Script]]
- [[_COMMUNITY_Pre-dev Script|Pre-dev Script]]
- [[_COMMUNITY_Route Action (A)|Route Action (A)]]
- [[_COMMUNITY_Route Action (B)|Route Action (B)]]
- [[_COMMUNITY_Populate Action|Populate Action]]
- [[_COMMUNITY_Route Action (C)|Route Action (C)]]
- [[_COMMUNITY_Raw Results Action|Raw Results Action]]

## God Nodes (most connected - your core abstractions)
1. `useThingtime()` - 36 edges
2. `getSelectedImages()` - 29 edges
3. `moveImageResultsToFinalDestination()` - 26 edges
4. `runOperation()` - 22 edges
5. `getDestinationPaths()` - 17 edges
6. `compilerOptions` - 16 edges
7. `compilerOptions` - 16 edges
8. `openNewFinderWindow()` - 15 edges
9. `regexToReplacementConverter()` - 15 edges
10. `regexTrim()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Thingtime-styled QR Code` --conceptually_related_to--> `Thingtime Branding`  [INFERRED]
  resources/svg/qrcode.svg → remix/public/branding/thingtime-horizontal.svg
- `Login()` --calls--> `useThingtime()`  [INFERRED]
  remix/app/components/Login/Login.tsx → remix/app/components/Thingtime/useThingtime.tsx
- `Index()` --calls--> `useThingtime()`  [EXTRACTED]
  remix/app/routes/$.tsx → remix/app/components/Thingtime/useThingtime.tsx
- `Index()` --calls--> `useThingtime()`  [INFERRED]
  remix/app/routes/_index.tsx → remix/app/components/Thingtime/useThingtime.tsx
- `Car Maintenance Tracking Use Case` --references--> `Thingtime Platform`  [EXTRACTED]
  docs/Use Cases/car.md → README.md

## Import Cycles
- 3-file cycle: `remix/app/api/utils/mongodb/connection.ts -> remix/app/routes/api/v1/mongodb/get-connection/_get-connection.tsx -> remix/app/api/utils/userCheckExists.ts -> remix/app/api/utils/mongodb/connection.ts`
- 3-file cycle: `remix/app/api/utils/mongodb/connection.ts -> remix/app/routes/api/v1/mongodb/get-connection/_get-connection.tsx -> remix/app/api/utils/userValidatePassword.ts -> remix/app/api/utils/mongodb/connection.ts`
- 3-file cycle: `remix/app/Providers/ThingtimeProvider.tsx -> remix/app/hooks/useThingtimeMachine.tsx -> remix/app/components/Thingtime/useThingtime.tsx -> remix/app/Providers/ThingtimeProvider.tsx`

## Hyperedges (group relationships)
- **WebP Encode/Decode Toolchain** — readme_webp_codec, readme_cwebp, readme_dwebp, readme_webp_conversion [EXTRACTED 0.90]
- **Image Modification Extension Documentation Set** — readme_image_modification_extension, changelog_image_modification, devlog_image_modification [INFERRED 0.85]
- **Thingtime Use Case Scenarios** — readme_thingtime, car_maintenance_tracking, tools_tool_sharing [INFERRED 0.85]
- **Displacement Effect SVG Family** — public_anti_displacement, public_displacement, public_displacement_gradient, public_displacement_gradient_2 [INFERRED 0.75]

## Communities (78 total, 14 thin omitted)

### Community 0 - "Raycast Image/File Operations"
Cohesion: 0.06
Nodes (79): openNewFinderWindow(), regexToReplacementConverter(), regexTrim(), any(), convert(), flip(), optimize(), optimizeJPEG() (+71 more)

### Community 1 - "Remix API Routes & Editor"
Cohesion: 0.09
Nodes (28): TestAPI(), getUsers(), rickDeckard(), Editor(), actionExport(), earlyReturn(), getConnectionAction, validConnections (+20 more)

### Community 2 - "Backend API Dependencies"
Cohesion: 0.04
Nodes (45): author, bugs, url, dependencies, axios, bcrypt, body-parser, cors (+37 more)

### Community 3 - "Remix Frontend Dependencies"
Cohesion: 0.05
Nodes (42): dependencies, axios, bcrypt, @chakra-ui/react, @chakra-ui/react-types, draft-js, @editorjs/editorjs, emojis-list (+34 more)

### Community 4 - "Remix Dev/Lint Dependencies"
Cohesion: 0.05
Nodes (40): devDependencies, @emotion/styled, eslint, eslint-config-prettier, eslint-loader, eslint-plugin-chakra-ui, eslint-plugin-hydrogen, eslint-plugin-prettier (+32 more)

### Community 5 - "Raycast Manifest & Deps"
Cohesion: 0.05
Nodes (38): author, categories, commands, contributors, dependencies, fuse.js, mathjs, @raycast/api (+30 more)

### Community 6 - "Raycast Image Generation & Filters"
Cohesion: 0.11
Nodes (23): ImageGeneratorActionPanel(), SizeSelectionActionPanel(), applyFilter(), applyBasicFilter(), filters, getFilterThumbnail(), initializeFilterScript(), generatePlaceholder() (+15 more)

### Community 7 - "Smarts Babel Codegen"
Cohesion: 0.07
Nodes (15): createObjectProperties(), deepForEach(), ee(), epp(), escapeEscapes(), escapePropertyPath(), forEachArray(), forEachObject() (+7 more)

### Community 8 - "Remix Root & Session Setup"
Cohesion: 0.08
Nodes (19): Session, App(), logConfig, whitelist, whitelistObj, ChakraWrapper(), chakras, chakrasDark (+11 more)

### Community 9 - "Thingtime Timeline/Timemachine"
Cohesion: 0.09
Nodes (23): assets, value, newTimeline(), PathArray, ThingtimeLine(), Timeline, TimelineEvent, TimelineScaffold (+15 more)

### Community 10 - "Smarts Package Manifest"
Cohesion: 0.08
Nodes (25): author, bugs, url, dependencies, smarts, ts-node, typescript, description (+17 more)

### Community 11 - "GradientPath SVG Library"
Cohesion: 0.19
Nodes (13): averageSegmentJoins(), getData(), outlineStrokes(), strokeToFill(), constructor(), render(), Sample, Segment (+5 more)

### Community 12 - "Raw Result Display Components"
Cohesion: 0.20
Nodes (9): TopSpacing(), Raw(), RawResult(), RawResultProps, RawResults(), Index(), Index(), useThingtime() (+1 more)

### Community 13 - "TypeScript Config (A)"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 14 - "TypeScript Config (B)"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 15 - "Remix Layout & Nav Components"
Cohesion: 0.24
Nodes (9): DevKit(), getQueryParams(), Icon(), Main(), Footer(), Nav(), ProfileDrawer(), RainbowSkeleton() (+1 more)

### Community 16 - "Commander V1 & MagicInput"
Cohesion: 0.22
Nodes (11): commanderArgs, CommanderV1(), useThings(), MagicInput, MagicInputProps, uuid, ThingtimeComponentProps, ThingtimeProps (+3 more)

### Community 17 - "Smarts Opts Manipulation"
Cohesion: 0.18
Nodes (16): addOpt(), anyOptsIn(), anyThingsIn(), optIn(), optIndex(), optsIn(), popOpt(), popOpts() (+8 more)

### Community 18 - "Commander V2 & Hooks"
Cohesion: 0.22
Nodes (8): CommanderV2(), sanitise(), usePath(), useProps(), useTrace(), useUuid(), Rainbow(), getParentPath()

### Community 19 - "TypeScript Config (C)"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, resolveJsonModule (+6 more)

### Community 20 - "Rainbow Text & Splash Demo"
Cohesion: 0.28
Nodes (5): RainbowText(), TextAnimation1(), Splash(), Thingtime(), ThingtimeDemo()

### Community 21 - "Speed-test Package"
Cohesion: 0.15
Nodes (12): author, dependencies, speed-test, speedtest-net, description, keywords, license, main (+4 more)

### Community 22 - "Thingtime Context & Types"
Cohesion: 0.20
Nodes (7): ThingtimeContext, ThingtimeTypes, Index(), ThingtimeURL(), EverythingTypes, ThingtimeTypes, useThingtimeScope

### Community 23 - "Smarts Context & Scoping"
Cohesion: 0.21
Nodes (12): addBindingsToContext(), context(), contextObject(), createContext(), createInlineContext(), getNodeUUID(), getPathUUID(), initBlock() (+4 more)

### Community 24 - "Image Mod Extension Docs & Tools"
Cohesion: 0.24
Nodes (11): Image Modification Extension Changelog, Image Modification DevLog, Apple CIFilters, cwebp Encoding Tool, dwebp Decoding Tool, Image Modification Raycast Extension, SIPS Image Commands, SVG Conversion via Potrace (+3 more)

### Community 25 - "Auth & Fetch Hooks"
Cohesion: 0.38
Nodes (4): Submit(), useApi(), useAsyncFetcher(), Login()

### Community 26 - "Raycast Command Type Defs"
Cohesion: 0.20
Nodes (9): Commander, CommanderConvert, CommanderMp4ToMp3, CommanderOpenNewFinderWindow, CommanderRegexToReplacementConverter, CommanderRegexTrim, CommanderTrim, ExtensionPreferences (+1 more)

### Community 27 - "Minimal Package Manifest"
Cohesion: 0.20
Nodes (9): author, description, license, main, name, scripts, test, type (+1 more)

### Community 28 - "Smarts Parser & Eval"
Cohesion: 0.22
Nodes (9): createScopedEval(), load(), parse(), parser(), play(), primitives(), revive(), safeparse() (+1 more)

### Community 29 - "Smart Path Access (get/set)"
Cohesion: 0.25
Nodes (9): deletesmart(), getsmart(), parsePropertyArray(), parsePropertyPath(), pathToArray(), pathToString(), ppa(), ppp() (+1 more)

### Community 31 - "McDonalds Promo Banner (gs2)"
Cohesion: 0.39
Nodes (8): McDonald's Promotional Menu Banner (gs2.png), Double Quarter Pounder Meal, Grimace Character Mascot, Grimace Shake Upgrade, McCrispy Meal, McDonald's Promotional Advertisement, McFlurry with OREO Cookie, Placeholder Pricing ($88.88)

### Community 32 - "ESLint Config"
Cohesion: 0.25
Nodes (7): env, es2020, node, extends, parser, plugins, root

### Community 33 - "Smart Thing Access (get/set)"
Cohesion: 0.29
Nodes (8): getThing(), popThing(), pushThing(), pushThings(), setThing(), setThings(), thingIn(), thingIndex()

### Community 34 - "Smarts Serialization"
Cohesion: 0.32
Nodes (8): pause(), replacer(), safestring(), save(), serialize(), setKnown(), stringifier(), stringify()

### Community 35 - "Branding & Displacement Map"
Cohesion: 0.38
Nodes (3): Branding(), Logo(), checkerMatrix

### Community 36 - "Displacement Map Assets"
Cohesion: 0.48
Nodes (3): Displacement Map, Gradient Deformation Map, Green Channel Gutter Mask

### Community 37 - "Smarts Object Clone/Merge"
Cohesion: 0.33
Nodes (7): basic(), clone(), create(), dupe(), merge(), mergeall(), schema()

### Community 38 - "Thingtime Vision & Use Cases"
Cohesion: 0.40
Nodes (6): Car Maintenance Tracking Use Case, Shareable Abstract Data Structures, Open Accessible Data Vision, Thingtime Platform, Sharing Economy Sustainability, Tool Sharing Use Case

### Community 39 - "Server Entry (Socket.io)"
Cohesion: 0.40
Nodes (4): app, io, server, smarts

### Community 40 - "Branding Logo & QR Codes"
Cohesion: 0.50
Nodes (5): Thingtime Branding, Thingtime Horizontal Logo, QR Code, Thingtime-styled QR Code, QR Code (qrcode.com)

### Community 41 - "Safe Component"
Cohesion: 0.70
Nodes (3): getMeta(), safe(), Safe()

### Community 42 - "Deformation Map (deformmap)"
Cohesion: 0.50
Nodes (5): Deformation Map, Two-Tone Green Color Regions, Smooth Curved Boundary, Displacement Map Effect, Visual Warp / Distortion Effect

### Community 43 - "Grimace Shake Background (gbg)"
Cohesion: 0.60
Nodes (5): Grimace Shake Background Image (gbg.png), Grimace Character, Grimace Shake Cup, McDonald's Promotional Branding, Purple Gradient Background

### Community 44 - "Remix Session Storage"
Cohesion: 0.50
Nodes (3): { getSession, commitSession, destroySession }, SessionData, SessionFlashData

### Community 45 - "Pink Plus Icon (Group 100)"
Cohesion: 0.83
Nodes (4): Group 100 (Pink Plus Icon), Cross / Plus Glyph, Plus / Add Icon, UI Button / Add Action

### Community 46 - "Add Icon (Group 99)"
Cohesion: 0.50
Nodes (4): Group 99 (Plus/Add Icon), Add / Create Action, Plus / Add Cross Icon, UI Icon Asset

### Community 47 - "Vercel Build Config"
Cohesion: 0.50
Nodes (3): build, env, ENABLE_FILE_SYSTEM_API

### Community 50 - "GH Logo (Purple Blobs)"
Cohesion: 1.00
Nodes (3): gh.png Logo Image, Brand Logo Mark, Three Purple Textured Blobs

## Knowledge Gaps
- **331 isolated node(s):** `extends`, `name`, `version`, `description`, `main` (+326 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useThingtime()` connect `Raw Result Display Components` to `Thingtime Timeline/Timemachine`, `Remix Layout & Nav Components`, `Commander V1 & MagicInput`, `Commander V2 & Hooks`, `Rainbow Text & Splash Demo`, `Thingtime Context & Types`, `Auth & Fetch Hooks`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Remix Frontend Dependencies` to `Remix Dev/Lint Dependencies`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `Thingtime()` connect `Rainbow Text & Splash Demo` to `Remix API Routes & Editor`, `Thingtime Timeline/Timemachine`, `Raw Result Display Components`, `Commander V1 & MagicInput`, `Commander V2 & Hooks`, `Thingtime Context & Types`, `Auth & Fetch Hooks`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `useThingtime()` (e.g. with `Login()` and `Index()`) actually correct?**
  _`useThingtime()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `extends`, `name`, `version` to the rest of the system?**
  _334 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Raycast Image/File Operations` be split into smaller, more focused modules?**
  _Cohesion score 0.06380996739636702 - nodes in this community are weakly interconnected._
- **Should `Remix API Routes & Editor` be split into smaller, more focused modules?**
  _Cohesion score 0.08823529411764706 - nodes in this community are weakly interconnected._