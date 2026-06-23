# Graph Report - thingtime  (2026-06-23)

## Corpus Check
- 247 files · ~578,807 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1352 nodes · 2440 edges · 97 communities (79 shown, 18 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c359fad7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Raycast ImageFile Operations|Raycast Image/File Operations]]
- [[_COMMUNITY_Community 1|Community 1]]
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
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_Smart Thing Access (getset)|Smart Thing Access (get/set)]]
- [[_COMMUNITY_Smarts Serialization|Smarts Serialization]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Displacement Map Assets|Displacement Map Assets]]
- [[_COMMUNITY_Smarts Object CloneMerge|Smarts Object Clone/Merge]]
- [[_COMMUNITY_Thingtime Vision & Use Cases|Thingtime Vision & Use Cases]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Branding Logo & QR Codes|Branding Logo & QR Codes]]
- [[_COMMUNITY_Deformation Map (deformmap)|Deformation Map (deformmap)]]
- [[_COMMUNITY_Grimace Shake Background (gbg)|Grimace Shake Background (gbg)]]
- [[_COMMUNITY_Remix Session Storage|Remix Session Storage]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Internet Speed Test Entry|Internet Speed Test Entry]]
- [[_COMMUNITY_GH Logo (Purple Blobs)|GH Logo (Purple Blobs)]]
- [[_COMMUNITY_Edge Route Config|Edge Route Config]]
- [[_COMMUNITY_Remix Request Handler|Remix Request Handler]]
- [[_COMMUNITY_Remix Server Entry|Remix Server Entry]]
- [[_COMMUNITY_Legacy Logo (Old2)|Legacy Logo (Old2)]]
- [[_COMMUNITY_Community 58|Community 58]]
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
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]

## God Nodes (most connected - your core abstractions)
1. `useThingtime()` - 38 edges
2. `getSelectedImages()` - 29 edges
3. `moveImageResultsToFinalDestination()` - 26 edges
4. `getVercelDeploymentStatus()` - 25 edges
5. `runOperation()` - 22 edges
6. `getDestinationPaths()` - 17 edges
7. `getCurrentUser()` - 16 edges
8. `compilerOptions` - 16 edges
9. `compilerOptions` - 16 edges
10. `openNewFinderWindow()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Index()` --calls--> `useThingtime()`  [INFERRED]
  remix/app/routes/_index.tsx → remix/app/components/Thingtime/useThingtime.tsx
- `action()` --calls--> `serializeAuthCookie()`  [INFERRED]
  remix/app/routes/api/v1/login/_login.tsx → remix/app/api/utils/auth/authCookie.ts
- `action()` --calls--> `loginUser()`  [INFERRED]
  remix/app/routes/api/v1/login/_login.tsx → remix/app/api/utils/auth/loginUser.ts
- `loader()` --calls--> `getMongoStatus()`  [INFERRED]
  remix/app/routes/api/v1/mongodb/status-data/_status-data.tsx → remix/app/api/utils/mongodb/status.ts
- `action()` --calls--> `getMongoStatus()`  [INFERRED]
  remix/app/routes/api/v1/mongodb/status/_status.tsx → remix/app/api/utils/mongodb/status.ts

## Import Cycles
- 3-file cycle: `remix/app/api/utils/mongodb/connection.ts -> remix/app/routes/api/v1/mongodb/get-connection/_get-connection.tsx -> remix/app/api/utils/userCheckExists.ts -> remix/app/api/utils/mongodb/connection.ts`
- 3-file cycle: `remix/app/api/utils/mongodb/connection.ts -> remix/app/routes/api/v1/mongodb/get-connection/_get-connection.tsx -> remix/app/api/utils/userValidatePassword.ts -> remix/app/api/utils/mongodb/connection.ts`
- 3-file cycle: `remix/app/Providers/ThingtimeProvider.tsx -> remix/app/hooks/useThingtimeMachine.tsx -> remix/app/components/Thingtime/useThingtime.tsx -> remix/app/Providers/ThingtimeProvider.tsx`

## Communities (97 total, 18 thin omitted)

### Community 0 - "Raycast Image/File Operations"
Cohesion: 0.06
Nodes (79): openNewFinderWindow(), regexToReplacementConverter(), regexTrim(), any(), convert(), flip(), optimize(), optimizeJPEG() (+71 more)

### Community 1 - "Community 1"
Cohesion: 0.22
Nodes (8): Deployment And Repo Hygiene, Hydration And Emotion, PR #13 - Hydration, Vercel Status, and Deployment Hygiene, Preserved Behavior, Summary, Vercel Runtime Fixes, Vercel Status And Branch Display, Verification

### Community 2 - "Backend API Dependencies"
Cohesion: 0.07
Nodes (36): Submit(), TestAPI(), getUsers(), SeedUser, Editor(), actionExport(), earlyReturn(), getConnectionAction (+28 more)

### Community 3 - "Remix Frontend Dependencies"
Cohesion: 0.04
Nodes (45): author, bugs, url, dependencies, axios, bcrypt, body-parser, cors (+37 more)

### Community 4 - "Remix Dev/Lint Dependencies"
Cohesion: 0.04
Nodes (48): dependencies, @anthropic-ai/sdk, axios, bcrypt, @chakra-ui/react, @chakra-ui/react-types, draft-js, @editorjs/editorjs (+40 more)

### Community 5 - "Raycast Manifest & Deps"
Cohesion: 0.08
Nodes (26): devDependencies, @emotion/styled, eslint, eslint-config-prettier, eslint-loader, eslint-plugin-chakra-ui, eslint-plugin-hydrogen, eslint-plugin-prettier (+18 more)

### Community 6 - "Raycast Image Generation & Filters"
Cohesion: 0.05
Nodes (38): author, categories, commands, contributors, dependencies, fuse.js, mathjs, @raycast/api (+30 more)

### Community 7 - "Smarts Babel Codegen"
Cohesion: 0.09
Nodes (23): assets, value, newTimeline(), PathArray, ThingtimeLine(), Timeline, TimelineEvent, TimelineScaffold (+15 more)

### Community 8 - "Remix Root & Session Setup"
Cohesion: 0.07
Nodes (15): createObjectProperties(), deepForEach(), ee(), epp(), escapeEscapes(), escapePropertyPath(), forEachArray(), forEachObject() (+7 more)

### Community 9 - "Thingtime Timeline/Timemachine"
Cohesion: 0.06
Nodes (38): Session, ClientCacheProvider(), createEmotionServerInstance, EmotionServerFactory, getExport(), handleRequest(), resolveEmotionServerFactory(), App() (+30 more)

### Community 10 - "Smarts Package Manifest"
Cohesion: 0.11
Nodes (23): ImageGeneratorActionPanel(), SizeSelectionActionPanel(), applyFilter(), applyBasicFilter(), filters, getFilterThumbnail(), initializeFilterScript(), generatePlaceholder() (+15 more)

### Community 11 - "GradientPath SVG Library"
Cohesion: 0.19
Nodes (13): averageSegmentJoins(), getData(), outlineStrokes(), strokeToFill(), constructor(), render(), Sample, Segment (+5 more)

### Community 12 - "Raw Result Display Components"
Cohesion: 0.08
Nodes (25): author, bugs, url, dependencies, smarts, ts-node, typescript, description (+17 more)

### Community 13 - "TypeScript Config (A)"
Cohesion: 0.22
Nodes (9): scripts, build, dev, ensure-bcrypt, format, lint, lint-fix, postinstall (+1 more)

### Community 14 - "TypeScript Config (B)"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 15 - "Remix Layout & Nav Components"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 16 - "Commander V1 & MagicInput"
Cohesion: 0.06
Nodes (65): authCookie, clearAuthCookie(), getAuthToken(), serializeAuthCookie(), shouldShowDevVerificationLink(), SendArgs, sendEmail(), sendVerificationEmail() (+57 more)

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

### Community 31 - "Community 31"
Cohesion: 0.33
Nodes (7): basic(), clone(), create(), dupe(), merge(), mergeall(), schema()

### Community 32 - "ESLint Config"
Cohesion: 0.29
Nodes (6): APIs, Bugs, Discuss, Encoding and Decoding Tools, Files, WebP Codec

### Community 33 - "Smart Thing Access (get/set)"
Cohesion: 0.17
Nodes (11): Auth and Lopu AI, 💹 Donate on Indiegogo to save humanity 🩷, Force Push ? 👉👈, MongoDB, Or Donate on GoFundMe 💖, Public env exposure rule, Remix app, Setup for Forks (+3 more)

### Community 34 - "Smarts Serialization"
Cohesion: 0.40
Nodes (4): app, io, server, smarts

### Community 35 - "Community 35"
Cohesion: 0.14
Nodes (13): Raw(), RawResult(), RawResultProps, RawResults(), ThingtimeContext, ThingtimeTypes, Index(), ThingtimeURL() (+5 more)

### Community 36 - "Displacement Map Assets"
Cohesion: 0.50
Nodes (3): { getSession, commitSession, destroySession }, SessionData, SessionFlashData

### Community 37 - "Smarts Object Clone/Merge"
Cohesion: 0.50
Nodes (3): Commands, Features, Image Modification

### Community 38 - "Thingtime Vision & Use Cases"
Cohesion: 0.50
Nodes (3): Deploy Your Own, Development, Remix

### Community 39 - "Community 39"
Cohesion: 0.19
Nodes (9): RainbowText(), TextAnimation1(), Nav(), ProfileDrawer(), Index(), Index(), Splash(), Thingtime() (+1 more)

### Community 44 - "Remix Session Storage"
Cohesion: 0.50
Nodes (3): Codex workspace notes, Delivery messaging, graphify

### Community 45 - "Community 45"
Cohesion: 0.70
Nodes (3): getMeta(), safe(), Safe()

### Community 46 - "Community 46"
Cohesion: 0.38
Nodes (3): Branding(), Logo(), checkerMatrix

### Community 49 - "Internet Speed Test Entry"
Cohesion: 0.50
Nodes (3): Fundamentals (read first), graphify, Shared agent instructions

### Community 72 - "Community 72"
Cohesion: 0.16
Nodes (12): commanderArgs, CommanderV2(), sanitise(), usePath(), useProps(), useTrace(), useUuid(), MagicInput (+4 more)

### Community 73 - "Community 73"
Cohesion: 0.11
Nodes (16): FALLBACK_MUSINGS, ALL_MODES, buildContextLine(), buildUserPrompt(), fetchWeather(), generateLopuMusing(), hasLopuAiProviderConfigured, LopuContext (+8 more)

### Community 74 - "Community 74"
Cohesion: 0.29
Nodes (6): Codex workspace notes, GitHub push / PR publishing, Graphify, Package manager notes, Remix linting, TypeScript checks

### Community 75 - "Community 75"
Cohesion: 0.18
Nodes (10): 03 — Auth: Login / Register / Sessions / JWT 🟢, Acceptance criteria, Built this round (`remix/app/api/utils/auth/`), Decisions (locked — see FUNDAMENTALS.md §5), Goal, Plan, Problems to fix, Still open (defaults fine for now) (+2 more)

### Community 76 - "Community 76"
Cohesion: 0.06
Nodes (63): getBranchLimitFromRequest(), getDeployments(), loader(), action(), loader(), loader(), StatusPage(), value() (+55 more)

### Community 77 - "Community 77"
Cohesion: 0.25
Nodes (7): extends, root, rules, no-unused-vars, @typescript-eslint/no-unused-vars, unused-imports/no-unused-imports, unused-imports/no-unused-vars

### Community 78 - "Community 78"
Cohesion: 0.17
Nodes (11): [1.0.0] - YYYY-MM-DD, Added, Changed, Changed, Changelog, Fixed, Fixed, PR #13 - Remix Hydration, Vercel Status, And Deployment Hygiene (+3 more)

### Community 80 - "Community 80"
Cohesion: 0.13
Nodes (31): action(), errorMessage(), base64UrlToBase64(), configuredPublicPem(), CRYPTO_STANDARDS, CryptoStandard, decodeBase64UrlText(), decodeKeyMaterial() (+23 more)

### Community 81 - "Community 81"
Cohesion: 0.22
Nodes (8): 1. The API is the only gateway to data, 2. Seed and test through the real API (functionality cohesion) ⭐, 3. One database: `thingtime`, 4. One MongoDB connection source, 5. Auth = httpOnly cookie + revocable JWT + Mongo session, 6. Never leak secrets, 7. One notification: Lopu 🦄, 🏛️ Thingtime Fundamentals

### Community 82 - "Community 82"
Cohesion: 0.25
Nodes (7): 02 — DB Populate / Seeding 🟡, Acceptance criteria, Decisions (locked — see FUNDAMENTALS.md), Goal, Plan, Problems to fix, What exists

### Community 83 - "Community 83"
Cohesion: 0.29
Nodes (6): Changed, Fixed, Follow-Up, PR #16 - Resolve Main Into Thingtime Dev Branch, Security Follow-Up - 2026-06-23, Verification

### Community 84 - "Community 84"
Cohesion: 0.29
Nodes (6): 04 — Authed DB Read + Query 🔴, Acceptance criteria, Goal, Plan, Security notes, What exists (to build on)

### Community 85 - "Community 85"
Cohesion: 0.29
Nodes (6): 05 — Authed DB Write (Create / Update / Delete) 🔴, Acceptance criteria, Goal, Plan, Security notes, What exists (to build on)

### Community 86 - "Community 86"
Cohesion: 0.23
Nodes (9): CommanderV1(), useThings(), Icon(), SettingsMenu(), ThingtimeComponentProps, ThingtimeProps, safeJoin(), safeSplit() (+1 more)

### Community 87 - "Community 87"
Cohesion: 0.33
Nodes (5): 01 — MongoDB Connection Status ✅, Goal, Possible follow-ups (nice-to-have), Verified, What exists

### Community 88 - "Community 88"
Cohesion: 0.33
Nodes (5): 1. JWT secret fallback, 2. Production source maps, 3. Atomic email verification token consumption, 4. Unused imports, PR 12 review actions

### Community 89 - "Community 89"
Cohesion: 0.40
Nodes (4): Conventions (see `FUNDAMENTALS.md`), ✅ Decisions (locked), Status board, 🧠 Thingtime × Claude — Feature To-Do

### Community 90 - "Community 90"
Cohesion: 0.40
Nodes (4): Decision log, Decisions, Nikolaj Frey — Engineer Decisions, Recurring principles (the thinking method)

### Community 91 - "Community 91"
Cohesion: 0.12
Nodes (15): ApiResponse, CryptoPage(), CryptoStandard, encodingLabel(), formatJson(), generatedEnvValue(), generatedKeyValue(), JsonOutput() (+7 more)

### Community 92 - "Community 92"
Cohesion: 0.29
Nodes (5): initial, install, path, repaired, { spawnSync }

### Community 94 - "Community 94"
Cohesion: 0.06
Nodes (41): getCurrentUser(), DevKit(), spin, useApi(), CurrentUser, useCurrentUser(), Login(), inputSx (+33 more)

### Community 98 - "Community 98"
Cohesion: 0.25
Nodes (7): engines, node, private, resolutions, @types/react, sideEffects, version

## Knowledge Gaps
- **505 isolated node(s):** `extends`, `name`, `version`, `description`, `main` (+500 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useThingtime()` connect `Community 35` to `Backend API Dependencies`, `Smarts Babel Codegen`, `Community 72`, `Community 39`, `Community 86`, `Community 94`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `getMongoUri()` connect `Backend API Dependencies` to `Commander V1 & MagicInput`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `Thingtime()` connect `Community 39` to `Backend API Dependencies`, `Community 35`, `Smarts Babel Codegen`, `Community 72`, `Community 86`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `useThingtime()` (e.g. with `Login()` and `Index()`) actually correct?**
  _`useThingtime()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `extends`, `name`, `version` to the rest of the system?**
  _505 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Raycast Image/File Operations` be split into smaller, more focused modules?**
  _Cohesion score 0.06346300533943555 - nodes in this community are weakly interconnected._
- **Should `Backend API Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06720321931589537 - nodes in this community are weakly interconnected._