# Graph Report - thingtime  (2026-06-22)

## Corpus Check
- 195 files · ~539,132 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 941 nodes · 1670 edges · 78 communities (59 shown, 19 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c218f92c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Displacement Map Assets|Displacement Map Assets]]
- [[_COMMUNITY_Smarts Object CloneMerge|Smarts Object Clone/Merge]]
- [[_COMMUNITY_Thingtime Vision & Use Cases|Thingtime Vision & Use Cases]]
- [[_COMMUNITY_Server Entry (Socket.io)|Server Entry (Socket.io)]]
- [[_COMMUNITY_Branding Logo & QR Codes|Branding Logo & QR Codes]]
- [[_COMMUNITY_Deformation Map (deformmap)|Deformation Map (deformmap)]]
- [[_COMMUNITY_Grimace Shake Background (gbg)|Grimace Shake Background (gbg)]]
- [[_COMMUNITY_Remix Session Storage|Remix Session Storage]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Add Icon (Group 99)|Add Icon (Group 99)]]
- [[_COMMUNITY_Internet Speed Test Entry|Internet Speed Test Entry]]
- [[_COMMUNITY_GH Logo (Purple Blobs)|GH Logo (Purple Blobs)]]
- [[_COMMUNITY_Edge Route Config|Edge Route Config]]
- [[_COMMUNITY_Remix Request Handler|Remix Request Handler]]
- [[_COMMUNITY_Remix Server Entry|Remix Server Entry]]
- [[_COMMUNITY_Legacy Logo (Old2)|Legacy Logo (Old2)]]
- [[_COMMUNITY_Favicon Imports & Deploy|Favicon Imports & Deploy]]
- [[_COMMUNITY_Pre-dev Script|Pre-dev Script]]
- [[_COMMUNITY_ESLint JS Config|ESLint JS Config]]
- [[_COMMUNITY_Remix Client Entry|Remix Client Entry]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]

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
- `Index()` --calls--> `useThingtime()`  [INFERRED]
  remix/app/routes/_index.tsx → remix/app/components/Thingtime/useThingtime.tsx
- `Login()` --calls--> `useThingtime()`  [INFERRED]
  remix/app/components/Login/Login.tsx → remix/app/components/Thingtime/useThingtime.tsx
- `Index()` --calls--> `useThingtime()`  [EXTRACTED]
  remix/app/routes/ode.tsx → remix/app/components/Thingtime/useThingtime.tsx
- `action()` --calls--> `getUser()`  [INFERRED]
  remix/app/routes/api/v1/login/_login.tsx → remix/app/api/utils/getUser.ts
- `loader()` --calls--> `getMongoStatus()`  [EXTRACTED]
  remix/app/routes/mongodb-status.tsx → remix/app/api/utils/mongodb/status.ts

## Import Cycles
- 3-file cycle: `remix/app/api/utils/mongodb/connection.ts -> remix/app/routes/api/v1/mongodb/get-connection/_get-connection.tsx -> remix/app/api/utils/userCheckExists.ts -> remix/app/api/utils/mongodb/connection.ts`
- 3-file cycle: `remix/app/api/utils/mongodb/connection.ts -> remix/app/routes/api/v1/mongodb/get-connection/_get-connection.tsx -> remix/app/api/utils/userValidatePassword.ts -> remix/app/api/utils/mongodb/connection.ts`
- 3-file cycle: `remix/app/Providers/ThingtimeProvider.tsx -> remix/app/hooks/useThingtimeMachine.tsx -> remix/app/components/Thingtime/useThingtime.tsx -> remix/app/Providers/ThingtimeProvider.tsx`

## Communities (78 total, 19 thin omitted)

### Community 0 - "Raycast Image/File Operations"
Cohesion: 0.06
Nodes (81): openNewFinderWindow(), regexToReplacementConverter(), regexTrim(), any(), convert(), applyFilter(), flip(), optimize() (+73 more)

### Community 1 - "Remix API Routes & Editor"
Cohesion: 0.17
Nodes (14): commanderArgs, CommanderV1(), useThings(), PathArray, Icon(), MagicInput, MagicInputProps, uuid (+6 more)

### Community 2 - "Backend API Dependencies"
Cohesion: 0.07
Nodes (34): Submit(), getUsers(), rickDeckard(), actionExport(), earlyReturn(), getConnectionAction, useAsyncFetcher(), action() (+26 more)

### Community 3 - "Remix Frontend Dependencies"
Cohesion: 0.04
Nodes (45): author, bugs, url, dependencies, axios, bcrypt, body-parser, cors (+37 more)

### Community 4 - "Remix Dev/Lint Dependencies"
Cohesion: 0.05
Nodes (44): dependencies, axios, bcrypt, @chakra-ui/react, @chakra-ui/react-types, draft-js, @editorjs/editorjs, emojis-list (+36 more)

### Community 5 - "Raycast Manifest & Deps"
Cohesion: 0.08
Nodes (26): devDependencies, @emotion/styled, eslint, eslint-config-prettier, eslint-loader, eslint-plugin-chakra-ui, eslint-plugin-hydrogen, eslint-plugin-prettier (+18 more)

### Community 6 - "Raycast Image Generation & Filters"
Cohesion: 0.05
Nodes (38): author, categories, commands, contributors, dependencies, fuse.js, mathjs, @raycast/api (+30 more)

### Community 7 - "Smarts Babel Codegen"
Cohesion: 0.09
Nodes (22): assets, value, newTimeline(), ThingtimeLine(), Timeline, TimelineEvent, TimelineScaffold, Timemachine (+14 more)

### Community 8 - "Remix Root & Session Setup"
Cohesion: 0.07
Nodes (15): createObjectProperties(), deepForEach(), ee(), epp(), escapeEscapes(), escapePropertyPath(), forEachArray(), forEachObject() (+7 more)

### Community 9 - "Thingtime Timeline/Timemachine"
Cohesion: 0.08
Nodes (20): Session, App(), logConfig, whitelist, whitelistObj, ChakraWrapper(), chakras, chakrasDark (+12 more)

### Community 10 - "Smarts Package Manifest"
Cohesion: 0.12
Nodes (21): ImageGeneratorActionPanel(), SizeSelectionActionPanel(), applyBasicFilter(), filters, getFilterThumbnail(), initializeFilterScript(), generatePlaceholder(), generatePreview() (+13 more)

### Community 11 - "GradientPath SVG Library"
Cohesion: 0.13
Nodes (17): averageSegmentJoins(), getData(), outlineStrokes(), strokeToFill(), constructor(), render(), Sample, Segment (+9 more)

### Community 12 - "Raw Result Display Components"
Cohesion: 0.08
Nodes (25): author, bugs, url, dependencies, smarts, ts-node, typescript, description (+17 more)

### Community 13 - "TypeScript Config (A)"
Cohesion: 0.16
Nodes (7): TestAPI(), Branding(), Logo(), Editor(), TopSpacing(), Raw(), checkerMatrix

### Community 14 - "TypeScript Config (B)"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 15 - "Remix Layout & Nav Components"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 17 - "Smarts Opts Manipulation"
Cohesion: 0.18
Nodes (16): addOpt(), anyOptsIn(), anyThingsIn(), optIn(), optIndex(), optsIn(), popOpt(), popOpts() (+8 more)

### Community 18 - "Commander V2 & Hooks"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, resolveJsonModule (+6 more)

### Community 19 - "TypeScript Config (C)"
Cohesion: 0.15
Nodes (12): author, dependencies, speed-test, speedtest-net, description, keywords, license, main (+4 more)

### Community 20 - "Rainbow Text & Splash Demo"
Cohesion: 0.21
Nodes (12): addBindingsToContext(), context(), contextObject(), createContext(), createInlineContext(), getNodeUUID(), getPathUUID(), initBlock() (+4 more)

### Community 21 - "Speed-test Package"
Cohesion: 0.20
Nodes (9): [Create Images, In-Clipboard Modification] - 2023-07-06, [Filters] - 2023-03-22, Image Modification Changelog, [Initial Version] - 2023-02-23, [Localization Fix] - 2023-03-07, [Optimize Images, SVG Conversion, More Filters] - 2023-04-03, [Padding, Bug Fixes] - 2023-03-15, [Strip EXIF Data] - 2024-01-28 (+1 more)

### Community 22 - "Thingtime Context & Types"
Cohesion: 0.20
Nodes (9): Commander, CommanderConvert, CommanderMp4ToMp3, CommanderOpenNewFinderWindow, CommanderRegexToReplacementConverter, CommanderRegexTrim, CommanderTrim, ExtensionPreferences (+1 more)

### Community 23 - "Smarts Context & Scoping"
Cohesion: 0.20
Nodes (9): author, description, license, main, name, scripts, test, type (+1 more)

### Community 24 - "Image Mod Extension Docs & Tools"
Cohesion: 0.22
Nodes (9): createScopedEval(), load(), parse(), parser(), play(), primitives(), revive(), safeparse() (+1 more)

### Community 25 - "Auth & Fetch Hooks"
Cohesion: 0.25
Nodes (9): deletesmart(), getsmart(), parsePropertyArray(), parsePropertyPath(), pathToArray(), pathToString(), ppa(), ppp() (+1 more)

### Community 27 - "Minimal Package Manifest"
Cohesion: 0.25
Nodes (7): env, es2020, node, extends, parser, plugins, root

### Community 28 - "Smarts Parser & Eval"
Cohesion: 0.29
Nodes (8): getThing(), popThing(), pushThing(), pushThings(), setThing(), setThings(), thingIn(), thingIndex()

### Community 29 - "Smart Path Access (get/set)"
Cohesion: 0.32
Nodes (8): pause(), replacer(), safestring(), save(), serialize(), setKnown(), stringifier(), stringify()

### Community 30 - "Reactive Navigation Components"
Cohesion: 0.29
Nodes (6): 2023-06-18, 2023-07-05, 2023-07-06, 2024-01-27, 2024-01-28, Image Modification DevLog - A more detailed changelog

### Community 31 - "McDonalds Promo Banner (gs2)"
Cohesion: 0.33
Nodes (7): basic(), clone(), create(), dupe(), merge(), mergeall(), schema()

### Community 32 - "ESLint Config"
Cohesion: 0.29
Nodes (6): APIs, Bugs, Discuss, Encoding and Decoding Tools, Files, WebP Codec

### Community 33 - "Smart Thing Access (get/set)"
Cohesion: 0.33
Nodes (5): 💹 Donate on Indiegogo to save humanity 🩷, Force Push ? 👉👈, Or Donate on GoFundMe 💖, 🌈 Welcome 👋 to Thingtime 🦄 🧠, You can get Merch 🌈 + other benefits 🦄💯

### Community 34 - "Smarts Serialization"
Cohesion: 0.40
Nodes (4): app, io, server, smarts

### Community 35 - "Community 35"
Cohesion: 0.15
Nodes (14): DevKit(), getQueryParams(), RawResult(), RawResultProps, RawResults(), ThingtimeContext, ThingtimeTypes, Index() (+6 more)

### Community 36 - "Displacement Map Assets"
Cohesion: 0.50
Nodes (3): { getSession, commitSession, destroySession }, SessionData, SessionFlashData

### Community 37 - "Smarts Object Clone/Merge"
Cohesion: 0.50
Nodes (3): Commands, Features, Image Modification

### Community 38 - "Thingtime Vision & Use Cases"
Cohesion: 0.50
Nodes (3): Deploy Your Own, Development, Remix

### Community 39 - "Server Entry (Socket.io)"
Cohesion: 0.50
Nodes (3): build, env, ENABLE_FILE_SYSTEM_API

### Community 45 - "Community 45"
Cohesion: 0.25
Nodes (7): engines, node, private, resolutions, @types/react, sideEffects, version

### Community 46 - "Add Icon (Group 99)"
Cohesion: 0.52
Nodes (4): emotionStylesToHtml(), handleRequest(), removeEmotionInlineStyles(), createEmotionCache()

### Community 58 - "Favicon Imports & Deploy"
Cohesion: 0.19
Nodes (11): CommanderV2(), sanitise(), usePath(), MongoStatus(), pulse, MongoConnectionStatus, Footer(), Nav() (+3 more)

### Community 72 - "Community 72"
Cohesion: 0.29
Nodes (7): scripts, build, dev, format, lint, lint-fix, pre-dev

### Community 73 - "Community 73"
Cohesion: 0.23
Nodes (7): RainbowText(), TextAnimation1(), Index(), Index(), Splash(), Thingtime(), ThingtimeDemo()

### Community 74 - "Community 74"
Cohesion: 0.29
Nodes (6): Codex workspace notes, GitHub push / PR publishing, Graphify, Package manager notes, Remix linting, TypeScript checks

### Community 76 - "Community 76"
Cohesion: 0.70
Nodes (3): getMeta(), safe(), Safe()

## Knowledge Gaps
- **359 isolated node(s):** `extends`, `name`, `version`, `description`, `main` (+354 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useThingtime()` connect `Community 35` to `Remix API Routes & Editor`, `Backend API Dependencies`, `Smarts Babel Codegen`, `Community 73`, `Community 75`, `TypeScript Config (A)`, `Favicon Imports & Deploy`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Remix Dev/Lint Dependencies` to `Community 45`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `Thingtime()` connect `Community 73` to `Remix API Routes & Editor`, `Backend API Dependencies`, `Community 35`, `Smarts Babel Codegen`, `Community 75`, `Favicon Imports & Deploy`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `useThingtime()` (e.g. with `Login()` and `Index()`) actually correct?**
  _`useThingtime()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `extends`, `name`, `version` to the rest of the system?**
  _359 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Raycast Image/File Operations` be split into smaller, more focused modules?**
  _Cohesion score 0.061102407064520727 - nodes in this community are weakly interconnected._
- **Should `Backend API Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07412587412587412 - nodes in this community are weakly interconnected._