# Graph Report - resolve-thingtime-dev-67n4f1-main  (2026-06-23)

## Corpus Check
- 236 files · ~559,669 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1203 nodes · 2163 edges · 91 communities (75 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2481d61e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
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

## God Nodes (most connected - your core abstractions)
1. `useThingtime()` - 38 edges
2. `getSelectedImages()` - 29 edges
3. `moveImageResultsToFinalDestination()` - 26 edges
4. `getVercelDeploymentStatus()` - 24 edges
5. `runOperation()` - 22 edges
6. `getDestinationPaths()` - 17 edges
7. `getCurrentUser()` - 16 edges
8. `compilerOptions` - 16 edges
9. `compilerOptions` - 16 edges
10. `openNewFinderWindow()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `action()` --calls--> `serializeAuthCookie()`  [INFERRED]
  remix/app/routes/api/v1/login/_login.tsx → remix/app/api/utils/auth/authCookie.ts
- `loader()` --calls--> `getCurrentUser()`  [EXTRACTED]
  remix/app/routes/welcome.tsx → remix/app/api/utils/auth/getCurrentUser.ts
- `loader()` --calls--> `getMongoStatus()`  [INFERRED]
  remix/app/routes/api/v1/mongodb/status-data/_status-data.tsx → remix/app/api/utils/mongodb/status.ts
- `action()` --calls--> `getMongoStatus()`  [INFERRED]
  remix/app/routes/api/v1/mongodb/status/_status.tsx → remix/app/api/utils/mongodb/status.ts
- `loader()` --calls--> `getMongoStatus()`  [INFERRED]
  remix/app/routes/api/v1/mongodb/status/_status.tsx → remix/app/api/utils/mongodb/status.ts

## Import Cycles
- 3-file cycle: `remix/app/api/utils/mongodb/connection.ts -> remix/app/routes/api/v1/mongodb/get-connection/_get-connection.tsx -> remix/app/api/utils/userCheckExists.ts -> remix/app/api/utils/mongodb/connection.ts`
- 3-file cycle: `remix/app/api/utils/mongodb/connection.ts -> remix/app/routes/api/v1/mongodb/get-connection/_get-connection.tsx -> remix/app/api/utils/userValidatePassword.ts -> remix/app/api/utils/mongodb/connection.ts`
- 3-file cycle: `remix/app/Providers/ThingtimeProvider.tsx -> remix/app/hooks/useThingtimeMachine.tsx -> remix/app/components/Thingtime/useThingtime.tsx -> remix/app/Providers/ThingtimeProvider.tsx`

## Communities (91 total, 16 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (79): openNewFinderWindow(), regexToReplacementConverter(), regexTrim(), any(), convert(), flip(), optimize(), optimizeJPEG() (+71 more)

### Community 1 - "Community 1"
Cohesion: 0.22
Nodes (8): Deployment And Repo Hygiene, Hydration And Emotion, PR #13 - Hydration, Vercel Status, and Deployment Hygiene, Preserved Behavior, Summary, Vercel Runtime Fixes, Vercel Status And Branch Display, Verification

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (32): loginUser(), getUsers(), SeedUser, actionExport(), earlyReturn(), getConnectionAction, action(), getClient() (+24 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (45): author, bugs, url, dependencies, axios, bcrypt, body-parser, cors (+37 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (48): dependencies, @anthropic-ai/sdk, axios, bcrypt, @chakra-ui/react, @chakra-ui/react-types, draft-js, @editorjs/editorjs (+40 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (26): devDependencies, @emotion/styled, eslint, eslint-config-prettier, eslint-loader, eslint-plugin-chakra-ui, eslint-plugin-hydrogen, eslint-plugin-prettier (+18 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (38): author, categories, commands, contributors, dependencies, fuse.js, mathjs, @raycast/api (+30 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (26): assets, value, newTimeline(), PathArray, ThingtimeLine(), Timeline, TimelineEvent, TimelineScaffold (+18 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (15): createObjectProperties(), deepForEach(), ee(), epp(), escapeEscapes(), escapePropertyPath(), forEachArray(), forEachObject() (+7 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (38): Session, ClientCacheProvider(), createEmotionServerInstance, EmotionServerFactory, getExport(), handleRequest(), resolveEmotionServerFactory(), App() (+30 more)

### Community 10 - "Community 10"
Cohesion: 0.10
Nodes (23): ImageGeneratorActionPanel(), SizeSelectionActionPanel(), applyFilter(), applyBasicFilter(), filters, getFilterThumbnail(), initializeFilterScript(), generatePlaceholder() (+15 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (17): averageSegmentJoins(), getData(), outlineStrokes(), strokeToFill(), constructor(), render(), Sample, Segment (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (25): author, bugs, url, dependencies, smarts, ts-node, typescript, description (+17 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (10): TestAPI(), Branding(), Logo(), Editor(), TopSpacing(), Raw(), RawResult(), RawResultProps (+2 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 16 - "Community 16"
Cohesion: 0.08
Nodes (47): authCookie, clearAuthCookie(), getAuthToken(), serializeAuthCookie(), SendArgs, sendEmail(), sendVerificationEmail(), consumeEmailVerification() (+39 more)

### Community 17 - "Community 17"
Cohesion: 0.18
Nodes (16): addOpt(), anyOptsIn(), anyThingsIn(), optIn(), optIndex(), optsIn(), popOpt(), popOpts() (+8 more)

### Community 18 - "Community 18"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, resolveJsonModule (+6 more)

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (12): author, dependencies, speed-test, speedtest-net, description, keywords, license, main (+4 more)

### Community 20 - "Community 20"
Cohesion: 0.21
Nodes (12): addBindingsToContext(), context(), contextObject(), createContext(), createInlineContext(), getNodeUUID(), getPathUUID(), initBlock() (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.20
Nodes (9): [Create Images, In-Clipboard Modification] - 2023-07-06, [Filters] - 2023-03-22, Image Modification Changelog, [Initial Version] - 2023-02-23, [Localization Fix] - 2023-03-07, [Optimize Images, SVG Conversion, More Filters] - 2023-04-03, [Padding, Bug Fixes] - 2023-03-15, [Strip EXIF Data] - 2024-01-28 (+1 more)

### Community 22 - "Community 22"
Cohesion: 0.20
Nodes (9): Commander, CommanderConvert, CommanderMp4ToMp3, CommanderOpenNewFinderWindow, CommanderRegexToReplacementConverter, CommanderRegexTrim, CommanderTrim, ExtensionPreferences (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.20
Nodes (9): author, description, license, main, name, scripts, test, type (+1 more)

### Community 24 - "Community 24"
Cohesion: 0.22
Nodes (9): createScopedEval(), load(), parse(), parser(), play(), primitives(), revive(), safeparse() (+1 more)

### Community 25 - "Community 25"
Cohesion: 0.25
Nodes (9): deletesmart(), getsmart(), parsePropertyArray(), parsePropertyPath(), pathToArray(), pathToString(), ppa(), ppp() (+1 more)

### Community 27 - "Community 27"
Cohesion: 0.25
Nodes (7): env, es2020, node, extends, parser, plugins, root

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (8): getThing(), popThing(), pushThing(), pushThings(), setThing(), setThings(), thingIn(), thingIndex()

### Community 29 - "Community 29"
Cohesion: 0.32
Nodes (8): pause(), replacer(), safestring(), save(), serialize(), setKnown(), stringifier(), stringify()

### Community 30 - "Community 30"
Cohesion: 0.29
Nodes (6): 2023-06-18, 2023-07-05, 2023-07-06, 2024-01-27, 2024-01-28, Image Modification DevLog - A more detailed changelog

### Community 31 - "Community 31"
Cohesion: 0.33
Nodes (7): basic(), clone(), create(), dupe(), merge(), mergeall(), schema()

### Community 32 - "Community 32"
Cohesion: 0.29
Nodes (6): APIs, Bugs, Discuss, Encoding and Decoding Tools, Files, WebP Codec

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (10): 💹 Donate on Indiegogo to save humanity 🩷, Force Push ? 👉👈, MongoDB, Or Donate on GoFundMe 💖, Public env exposure rule, Remix app, Setup for Forks, Vercel deployment status (+2 more)

### Community 34 - "Community 34"
Cohesion: 0.40
Nodes (4): app, io, server, smarts

### Community 35 - "Community 35"
Cohesion: 0.16
Nodes (12): Submit(), useAsyncFetcher(), Index(), Index(), Index(), SettingsMenu(), ThingtimeURL(), EverythingTypes (+4 more)

### Community 36 - "Community 36"
Cohesion: 0.50
Nodes (3): { getSession, commitSession, destroySession }, SessionData, SessionFlashData

### Community 37 - "Community 37"
Cohesion: 0.50
Nodes (3): Commands, Features, Image Modification

### Community 38 - "Community 38"
Cohesion: 0.50
Nodes (3): Deploy Your Own, Development, Remix

### Community 39 - "Community 39"
Cohesion: 0.28
Nodes (5): RainbowText(), TextAnimation1(), Splash(), Thingtime(), ThingtimeDemo()

### Community 44 - "Community 44"
Cohesion: 0.50
Nodes (3): Codex workspace notes, Delivery messaging, graphify

### Community 45 - "Community 45"
Cohesion: 0.26
Nodes (8): CommanderV2(), sanitise(), usePath(), Footer(), Nav(), ProfileDrawer(), RainbowSkeleton(), getParentPath()

### Community 46 - "Community 46"
Cohesion: 0.30
Nodes (9): DevKit(), spin, useApi(), Icon(), Login(), inputSx, Register(), useLopu() (+1 more)

### Community 72 - "Community 72"
Cohesion: 0.18
Nodes (13): commanderArgs, CommanderV1(), getMeta(), safe(), useThings(), MagicInput, MagicInputProps, Safe() (+5 more)

### Community 73 - "Community 73"
Cohesion: 0.11
Nodes (15): FALLBACK_MUSINGS, ALL_MODES, buildContextLine(), buildUserPrompt(), fetchWeather(), generateLopuMusing(), LopuContext, LopuMode (+7 more)

### Community 74 - "Community 74"
Cohesion: 0.29
Nodes (6): Codex workspace notes, GitHub push / PR publishing, Graphify, Package manager notes, Remix linting, TypeScript checks

### Community 75 - "Community 75"
Cohesion: 0.18
Nodes (10): 03 — Auth: Login / Register / Sessions / JWT 🟢, Acceptance criteria, Built this round (`remix/app/api/utils/auth/`), Decisions (locked — see FUNDAMENTALS.md §5), Goal, Plan, Problems to fix, Still open (defaults fine for now) (+2 more)

### Community 76 - "Community 76"
Cohesion: 0.09
Nodes (39): MongoStatus(), pulse, STATUS_COLORS, MongoConnectionStatus, loader(), action(), loader(), loader() (+31 more)

### Community 77 - "Community 77"
Cohesion: 0.25
Nodes (7): extends, root, rules, no-unused-vars, @typescript-eslint/no-unused-vars, unused-imports/no-unused-imports, unused-imports/no-unused-vars

### Community 78 - "Community 78"
Cohesion: 0.22
Nodes (8): [1.0.0] - YYYY-MM-DD, Added, Changed, Changelog, Fixed, PR #13 - Remix Hydration, Vercel Status, And Deployment Hygiene, [Unreleased], Verified

### Community 79 - "Community 79"
Cohesion: 0.20
Nodes (8): blink, CONTAINER_STYLE, drain, LopuArgs, LopuLink, LopuStatus, LopuToast(), statusEmoji()

### Community 80 - "Community 80"
Cohesion: 0.40
Nodes (6): CurrentUser, useCurrentUser(), Profile(), loader(), Welcome(), UserCard()

### Community 81 - "Community 81"
Cohesion: 0.22
Nodes (8): 1. The API is the only gateway to data, 2. Seed and test through the real API (functionality cohesion) ⭐, 3. One database: `thingtime`, 4. One MongoDB connection source, 5. Auth = httpOnly cookie + revocable JWT + Mongo session, 6. Never leak secrets, 7. One notification: Lopu 🦄, 🏛️ Thingtime Fundamentals

### Community 82 - "Community 82"
Cohesion: 0.25
Nodes (7): 02 — DB Populate / Seeding 🟡, Acceptance criteria, Decisions (locked — see FUNDAMENTALS.md), Goal, Plan, Problems to fix, What exists

### Community 83 - "Community 83"
Cohesion: 0.25
Nodes (7): engines, node, private, resolutions, @types/react, sideEffects, version

### Community 84 - "Community 84"
Cohesion: 0.29
Nodes (6): 04 — Authed DB Read + Query 🔴, Acceptance criteria, Goal, Plan, Security notes, What exists (to build on)

### Community 85 - "Community 85"
Cohesion: 0.29
Nodes (6): 05 — Authed DB Write (Create / Update / Delete) 🔴, Acceptance criteria, Goal, Plan, Security notes, What exists (to build on)

### Community 86 - "Community 86"
Cohesion: 0.29
Nodes (7): scripts, build, dev, format, lint, lint-fix, pre-dev

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

## Knowledge Gaps
- **459 isolated node(s):** `extends`, `name`, `version`, `description`, `main` (+454 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useThingtime()` connect `Community 35` to `Community 7`, `Community 72`, `Community 39`, `Community 13`, `Community 45`, `Community 46`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `Thingtime()` connect `Community 39` to `Community 2`, `Community 35`, `Community 7`, `Community 72`, `Community 45`, `Community 46`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `getCurrentUser()` connect `Community 16` to `Community 80`, `Community 9`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `useThingtime()` (e.g. with `Login()` and `Index()`) actually correct?**
  _`useThingtime()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `extends`, `name`, `version` to the rest of the system?**
  _459 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.0631184407796102 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07814207650273224 - nodes in this community are weakly interconnected._