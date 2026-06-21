# Graph Report - thingtime  (2026-06-21)

## Corpus Check
- 184 files · ~537,710 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 919 nodes · 1624 edges · 68 communities (52 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3000a9c2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Raycast Image Operations|Raycast Image Operations]]
- [[_COMMUNITY_Thingtime Commander & Core UI|Thingtime Commander & Core UI]]
- [[_COMMUNITY_API Package Manifest|API Package Manifest]]
- [[_COMMUNITY_Remix Auth & User Routes|Remix Auth & User Routes]]
- [[_COMMUNITY_Remix Dependencies|Remix Dependencies]]
- [[_COMMUNITY_Remix Dev Dependencies|Remix Dev Dependencies]]
- [[_COMMUNITY_Raycast Extension Manifest|Raycast Extension Manifest]]
- [[_COMMUNITY_Image Generators & Filters|Image Generators & Filters]]
- [[_COMMUNITY_Thingtime State & Providers|Thingtime State & Providers]]
- [[_COMMUNITY_Smarts Core (BabelEval)|Smarts Core (Babel/Eval)]]
- [[_COMMUNITY_Remix Root & Theming|Remix Root & Theming]]
- [[_COMMUNITY_Graphics GP Utilities|Graphics GP Utilities]]
- [[_COMMUNITY_Templates & Branding Components|Templates & Branding Components]]
- [[_COMMUNITY_Root Package Manifest|Root Package Manifest]]
- [[_COMMUNITY_Remix TypeScript Config|Remix TypeScript Config]]
- [[_COMMUNITY_TypeScript Config (root)|TypeScript Config (root)]]
- [[_COMMUNITY_Smarts Opt Helpers|Smarts Opt Helpers]]
- [[_COMMUNITY_Raycast TypeScript Config|Raycast TypeScript Config]]
- [[_COMMUNITY_Lopu Speedtest Package|Lopu Speedtest Package]]
- [[_COMMUNITY_Smarts Context System|Smarts Context System]]
- [[_COMMUNITY_Raycast Env Types|Raycast Env Types]]
- [[_COMMUNITY_API src Package Manifest|API src Package Manifest]]
- [[_COMMUNITY_Smarts Eval & Parser|Smarts Eval & Parser]]
- [[_COMMUNITY_Smarts Path Resolution|Smarts Path Resolution]]
- [[_COMMUNITY_Nav & Button Components|Nav & Button Components]]
- [[_COMMUNITY_Raycast ESLint Config|Raycast ESLint Config]]
- [[_COMMUNITY_Thingtime Concepts & Use Cases|Thingtime Concepts & Use Cases]]
- [[_COMMUNITY_Smarts Thing Store|Smarts Thing Store]]
- [[_COMMUNITY_Smarts Serialization|Smarts Serialization]]
- [[_COMMUNITY_Smarts Object Cloning|Smarts Object Cloning]]
- [[_COMMUNITY_API Server Entry|API Server Entry]]
- [[_COMMUNITY_Remix Session Storage|Remix Session Storage]]
- [[_COMMUNITY_Remix Vercel Config|Remix Vercel Config]]
- [[_COMMUNITY_Global Type Declarations|Global Type Declarations]]
- [[_COMMUNITY_Web App Manifest|Web App Manifest]]
- [[_COMMUNITY_Edge Route|Edge Route]]
- [[_COMMUNITY_ESLint Config (root)|ESLint Config (root)]]
- [[_COMMUNITY_Pre-Dev Script|Pre-Dev Script]]
- [[_COMMUNITY_Vercel Build Script|Vercel Build Script]]
- [[_COMMUNITY_Get Connection Action|Get Connection Action]]
- [[_COMMUNITY_Populate Route Action|Populate Route Action]]
- [[_COMMUNITY_Populate Action|Populate Action]]
- [[_COMMUNITY_Raw Results Route Action|Raw Results Route Action]]
- [[_COMMUNITY_Raw Results Action|Raw Results Action]]
- [[_COMMUNITY_Raycast Extension Docs|Raycast Extension Docs]]
- [[_COMMUNITY_Remix Env Types|Remix Env Types]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]

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
- `Car Maintenance Tracking` --semantically_similar_to--> `Abstract Data Structures`  [INFERRED] [semantically similar]
  docs/Use Cases/car.md → README.md
- `Tool Sharing & Lending` --semantically_similar_to--> `Abstract Data Structures`  [INFERRED] [semantically similar]
  docs/Use Cases/tools.md → README.md
- `Remix Web App (Vercel)` --references--> `Thingtime Platform`  [INFERRED]
  remix/README.md → README.md
- `Index()` --calls--> `useThingtime()`  [INFERRED]
  remix/app/routes/_index.tsx → remix/app/components/Thingtime/useThingtime.tsx
- `Car Maintenance Tracking` --references--> `Thingtime Platform`  [EXTRACTED]
  docs/Use Cases/car.md → README.md

## Import Cycles
- 3-file cycle: `remix/app/api/utils/mongodb/connection.ts -> remix/app/routes/api/v1/mongodb/get-connection/_get-connection.tsx -> remix/app/api/utils/userValidatePassword.ts -> remix/app/api/utils/mongodb/connection.ts`
- 3-file cycle: `remix/app/api/utils/mongodb/connection.ts -> remix/app/routes/api/v1/mongodb/get-connection/_get-connection.tsx -> remix/app/api/utils/userCheckExists.ts -> remix/app/api/utils/mongodb/connection.ts`
- 3-file cycle: `remix/app/Providers/ThingtimeProvider.tsx -> remix/app/hooks/useThingtimeMachine.tsx -> remix/app/components/Thingtime/useThingtime.tsx -> remix/app/Providers/ThingtimeProvider.tsx`

## Hyperedges (group relationships)
- **Thingtime Use Cases** — use_cases_car_maintenance_tracking, use_cases_tools_tool_sharing, readme_thingtime_platform [INFERRED 0.75]

## Communities (68 total, 16 thin omitted)

### Community 0 - "Raycast Image Operations"
Cohesion: 0.08
Nodes (52): any(), convert(), flip(), optimize(), optimizeJPEG(), optimizeSVG(), optimizeWEBP(), pad() (+44 more)

### Community 1 - "Thingtime Commander & Core UI"
Cohesion: 0.06
Nodes (45): Submit(), Commander(), CommanderV2(), RainbowText(), TextAnimation1(), DevKit(), getQueryParams(), getMeta() (+37 more)

### Community 2 - "API Package Manifest"
Cohesion: 0.04
Nodes (45): author, bugs, url, dependencies, axios, bcrypt, body-parser, cors (+37 more)

### Community 3 - "Remix Auth & User Routes"
Cohesion: 0.10
Nodes (26): getUsers(), rickDeckard(), actionExport(), earlyReturn(), getConnectionAction, validConnections, action(), earlyReturn() (+18 more)

### Community 4 - "Remix Dependencies"
Cohesion: 0.05
Nodes (42): dependencies, axios, bcrypt, @chakra-ui/react, @chakra-ui/react-types, draft-js, @editorjs/editorjs, emojis-list (+34 more)

### Community 5 - "Remix Dev Dependencies"
Cohesion: 0.05
Nodes (40): devDependencies, @emotion/styled, eslint, eslint-config-prettier, eslint-loader, eslint-plugin-chakra-ui, eslint-plugin-hydrogen, eslint-plugin-prettier (+32 more)

### Community 6 - "Raycast Extension Manifest"
Cohesion: 0.05
Nodes (38): author, categories, commands, contributors, dependencies, fuse.js, mathjs, @raycast/api (+30 more)

### Community 7 - "Image Generators & Filters"
Cohesion: 0.10
Nodes (23): ImageGeneratorActionPanel(), SizeSelectionActionPanel(), applyFilter(), applyBasicFilter(), filters, getFilterThumbnail(), initializeFilterScript(), generatePlaceholder() (+15 more)

### Community 8 - "Thingtime State & Providers"
Cohesion: 0.09
Nodes (23): assets, value, newTimeline(), ThingtimeLine(), Timeline, TimelineEvent, TimelineScaffold, Timemachine (+15 more)

### Community 9 - "Smarts Core (Babel/Eval)"
Cohesion: 0.07
Nodes (15): createObjectProperties(), deepForEach(), ee(), epp(), escapeEscapes(), escapePropertyPath(), forEachArray(), forEachObject() (+7 more)

### Community 10 - "Remix Root & Theming"
Cohesion: 0.08
Nodes (19): Session, App(), logConfig, whitelist, whitelistObj, ChakraWrapper(), chakras, chakrasDark (+11 more)

### Community 11 - "Graphics GP Utilities"
Cohesion: 0.13
Nodes (17): averageSegmentJoins(), getData(), outlineStrokes(), strokeToFill(), constructor(), render(), Sample, Segment (+9 more)

### Community 12 - "Templates & Branding Components"
Cohesion: 0.16
Nodes (8): TestAPI(), Branding(), Logo(), Editor(), TopSpacing(), Raw(), RawResults(), checkerMatrix

### Community 13 - "Root Package Manifest"
Cohesion: 0.08
Nodes (24): author, bugs, url, dependencies, smarts, ts-node, typescript, description (+16 more)

### Community 14 - "Remix TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 15 - "TypeScript Config (root)"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 16 - "Smarts Opt Helpers"
Cohesion: 0.18
Nodes (16): addOpt(), anyOptsIn(), anyThingsIn(), optIn(), optIndex(), optsIn(), popOpt(), popOpts() (+8 more)

### Community 17 - "Raycast TypeScript Config"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, resolveJsonModule (+6 more)

### Community 18 - "Lopu Speedtest Package"
Cohesion: 0.15
Nodes (12): author, dependencies, speed-test, speedtest-net, description, keywords, license, main (+4 more)

### Community 19 - "Smarts Context System"
Cohesion: 0.21
Nodes (12): addBindingsToContext(), context(), contextObject(), createContext(), createInlineContext(), getNodeUUID(), getPathUUID(), initBlock() (+4 more)

### Community 20 - "Raycast Env Types"
Cohesion: 0.20
Nodes (9): Commander, CommanderConvert, CommanderMp4ToMp3, CommanderOpenNewFinderWindow, CommanderRegexToReplacementConverter, CommanderRegexTrim, CommanderTrim, ExtensionPreferences (+1 more)

### Community 21 - "API src Package Manifest"
Cohesion: 0.20
Nodes (9): author, description, license, main, name, scripts, test, type (+1 more)

### Community 22 - "Smarts Eval & Parser"
Cohesion: 0.22
Nodes (9): createScopedEval(), load(), parse(), parser(), play(), primitives(), revive(), safeparse() (+1 more)

### Community 23 - "Smarts Path Resolution"
Cohesion: 0.25
Nodes (9): deletesmart(), getsmart(), parsePropertyArray(), parsePropertyPath(), pathToArray(), pathToString(), ppa(), ppp() (+1 more)

### Community 25 - "Raycast ESLint Config"
Cohesion: 0.25
Nodes (7): env, es2020, node, extends, parser, plugins, root

### Community 26 - "Thingtime Concepts & Use Cases"
Cohesion: 0.32
Nodes (8): Abstract Data Structures, Open Data Sharing, Thingtime Platform, Remix Web App (Vercel), Car Maintenance Tracking, VIN History Lookup, Built-in Rental Payment, Tool Sharing & Lending

### Community 27 - "Smarts Thing Store"
Cohesion: 0.29
Nodes (8): getThing(), popThing(), pushThing(), pushThings(), setThing(), setThings(), thingIn(), thingIndex()

### Community 28 - "Smarts Serialization"
Cohesion: 0.32
Nodes (8): pause(), replacer(), safestring(), save(), serialize(), setKnown(), stringifier(), stringify()

### Community 29 - "Smarts Object Cloning"
Cohesion: 0.33
Nodes (7): basic(), clone(), create(), dupe(), merge(), mergeall(), schema()

### Community 30 - "API Server Entry"
Cohesion: 0.40
Nodes (4): app, io, server, smarts

### Community 31 - "Remix Session Storage"
Cohesion: 0.50
Nodes (3): { getSession, commitSession, destroySession }, SessionData, SessionFlashData

### Community 32 - "Remix Vercel Config"
Cohesion: 0.50
Nodes (3): build, env, ENABLE_FILE_SYSTEM_API

### Community 53 - "Raycast Extension Docs"
Cohesion: 0.50
Nodes (3): Commands, Features, Image Modification

### Community 58 - "Community 58"
Cohesion: 0.17
Nodes (27): openNewFinderWindow(), regexToReplacementConverter(), regexTrim(), Command(), convertFormats, formats, Command(), convertFormats (+19 more)

### Community 60 - "Community 60"
Cohesion: 0.19
Nodes (9): MongoStatus(), pulse, getMongoStatus(), getMongoUri(), MongoConnectionStatus, sanitiseHost(), loader(), action() (+1 more)

### Community 64 - "Community 64"
Cohesion: 0.20
Nodes (9): [Create Images, In-Clipboard Modification] - 2023-07-06, [Filters] - 2023-03-22, Image Modification Changelog, [Initial Version] - 2023-02-23, [Localization Fix] - 2023-03-07, [Optimize Images, SVG Conversion, More Filters] - 2023-04-03, [Padding, Bug Fixes] - 2023-03-15, [Strip EXIF Data] - 2024-01-28 (+1 more)

### Community 68 - "Community 68"
Cohesion: 0.29
Nodes (6): 2023-06-18, 2023-07-05, 2023-07-06, 2024-01-27, 2024-01-28, Image Modification DevLog - A more detailed changelog

### Community 69 - "Community 69"
Cohesion: 0.29
Nodes (6): APIs, Bugs, Discuss, Encoding and Decoding Tools, Files, WebP Codec

### Community 70 - "Community 70"
Cohesion: 0.33
Nodes (5): 💹 Donate on Indiegogo to save humanity 🩷, Force Push ? 👉👈, Or Donate on GoFundMe 💖, 🌈 Welcome 👋 to Thingtime 🦄 🧠, You can get Merch 🌈 + other benefits 🦄💯

### Community 72 - "Community 72"
Cohesion: 0.50
Nodes (3): Deploy Your Own, Development, Remix

## Knowledge Gaps
- **351 isolated node(s):** `extends`, `name`, `version`, `description`, `main` (+346 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useThingtime()` connect `Thingtime Commander & Core UI` to `Thingtime State & Providers`, `Templates & Branding Components`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Remix Dependencies` to `Remix Dev Dependencies`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `Thingtime()` connect `Thingtime Commander & Core UI` to `Thingtime State & Providers`, `Remix Auth & User Routes`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `useThingtime()` (e.g. with `Login()` and `Index()`) actually correct?**
  _`useThingtime()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `extends`, `name`, `version` to the rest of the system?**
  _351 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Raycast Image Operations` be split into smaller, more focused modules?**
  _Cohesion score 0.08441558441558442 - nodes in this community are weakly interconnected._
- **Should `Thingtime Commander & Core UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05742296918767507 - nodes in this community are weakly interconnected._