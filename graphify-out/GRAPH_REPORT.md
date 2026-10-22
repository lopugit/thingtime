# Graph Report - infallible-cray-66e445  (2026-09-02)

## Corpus Check
- 274 files · ~588,842 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1454 nodes · 2571 edges · 102 communities (79 shown, 23 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 113 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `847febff`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_utils.ts|utils.ts]]
- [[_COMMUNITY_registerUser.ts|registerUser.ts]]
- [[_COMMUNITY_status.ts|status.ts]]
- [[_COMMUNITY_dependencies|dependencies]]
- [[_COMMUNITY_dependencies|dependencies]]
- [[_COMMUNITY_devDependencies|devDependencies]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_getConnection|getConnection]]
- [[_COMMUNITY_DevKit.tsx|DevKit.tsx]]
- [[_COMMUNITY_index.tsx|index.tsx]]
- [[_COMMUNITY_cryptoTools.server.ts|cryptoTools.server.ts]]
- [[_COMMUNITY_ThingtimeProvider.tsx|ThingtimeProvider.tsx]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_generators.ts|generators.ts]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_useThingtime|useThingtime]]
- [[_COMMUNITY_musing.ts|musing.ts]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_GradientPath.js|GradientPath.js]]
- [[_COMMUNITY_Image Modification Changelog|Image Modification Changelog]]
- [[_COMMUNITY_raycast-env.d.ts|raycast-env.d.ts]]
- [[_COMMUNITY_Thingtime.tsx|Thingtime.tsx]]
- [[_COMMUNITY_crypto.tsx|crypto.tsx]]
- [[_COMMUNITY_colors.tsx|colors.tsx]]
- [[_COMMUNITY_.ds-entry.tsx|.ds-entry.tsx]]
- [[_COMMUNITY_.eslintrc.json|.eslintrc.json]]
- [[_COMMUNITY_Footer.tsx|Footer.tsx]]
- [[_COMMUNITY_Nav.tsx|Nav.tsx]]
- [[_COMMUNITY_Image Modification DevLog - A more detailed changelog|Image Modification DevLog - A more detailed changelog]]
- [[_COMMUNITY_optIn|optIn]]
- [[_COMMUNITY_root.tsx|root.tsx]]
- [[_COMMUNITY_Setup for Forks|Setup for Forks]]
- [[_COMMUNITY_Coordinator|Coordinator]]
- [[_COMMUNITY_react|react]]
- [[_COMMUNITY_createContext|createContext]]
- [[_COMMUNITY_Image Modification|Image Modification]]
- [[_COMMUNITY_Remix|Remix]]
- [[_COMMUNITY_entry.server.tsx|entry.server.tsx]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_nativeBridge.ts|nativeBridge.ts]]
- [[_COMMUNITY_parse|parse]]
- [[_COMMUNITY_parsePropertyPath|parsePropertyPath]]
- [[_COMMUNITY_AGENTS|AGENTS.md]]
- [[_COMMUNITY_entry.client.tsx|entry.client.tsx]]
- [[_COMMUNITY_thingIn|thingIn]]
- [[_COMMUNITY_stringify|stringify]]
- [[_COMMUNITY_iOS|iOS]]
- [[_COMMUNITY_CLAUDE|CLAUDE.md]]
- [[_COMMUNITY_.eslintrc.json|.eslintrc.json]]
- [[_COMMUNITY_vercel.sh|vercel.sh]]
- [[_COMMUNITY_WebP Codec|WebP Codec]]
- [[_COMMUNITY_merge|merge]]
- [[_COMMUNITY_ensure-bcrypt-binding.js|ensure-bcrypt-binding.js]]
- [[_COMMUNITY_Safe.tsx|Safe.tsx]]
- [[_COMMUNITY_TODO|TODO.md]]
- [[_COMMUNITY_sessions.ts|sessions.ts]]
- [[_COMMUNITY_global-types.d.ts|global-types.d.ts]]
- [[_COMMUNITY_edge.tsx|edge.tsx]]
- [[_COMMUNITY_manifest.json|manifest.json]]
- [[_COMMUNITY_car|car.md]]
- [[_COMMUNITY_tools|tools.md]]
- [[_COMMUNITY_bootstrap.sh|bootstrap.sh]]
- [[_COMMUNITY_Codex workspace notes|Codex workspace notes]]
- [[_COMMUNITY_03 — Auth Login  Register  Sessions  JWT 🟢|03 — Auth: Login / Register / Sessions / JWT 🟢]]
- [[_COMMUNITY_build.sh|build.sh]]
- [[_COMMUNITY_rules|rules]]
- [[_COMMUNITY_Unreleased|[Unreleased]]]
- [[_COMMUNITY_Thingtime iOS|Thingtime iOS]]
- [[_COMMUNITY_test.sh|test.sh]]
- [[_COMMUNITY_🏛️ Thingtime Fundamentals|🏛️ Thingtime Fundamentals]]
- [[_COMMUNITY_testflight-beta.sh|testflight-beta.sh]]
- [[_COMMUNITY__xcode-common.sh|_xcode-common.sh]]
- [[_COMMUNITY_Thingtime|Thingtime]]
- [[_COMMUNITY_PR 12 review actions|PR 12 review actions]]
- [[_COMMUNITY_pre-dev.sh|pre-dev.sh]]
- [[_COMMUNITY_Nikolaj Frey — Engineer Decisions|Nikolaj Frey — Engineer Decisions]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_getConnectionAction|getConnectionAction]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_populateAction|populateAction]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_rawResultsAction|rawResultsAction]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_loader|loader]]
- [[_COMMUNITY_Thingtime iOS Agent Runbook|Thingtime iOS Agent Runbook]]
- [[_COMMUNITY_CLAUDE|CLAUDE.md]]

## God Nodes (most connected - your core abstractions)
1. `useThingtime()` - 39 edges
2. `react` - 38 edges
3. `getSelectedImages()` - 28 edges
4. `moveImageResultsToFinalDestination()` - 26 edges
5. `getVercelDeploymentStatus()` - 26 edges
6. `runOperation()` - 22 edges
7. `getDestinationPaths()` - 17 edges
8. `getCurrentUser()` - 16 edges
9. `compilerOptions` - 16 edges
10. `compilerOptions` - 16 edges

## Surprising Connections (you probably didn't know these)
- `ThingtimeApp` --implements--> `app`  [EXTRACTED]
  iOS/Thingtime/App/ThingtimeApp.swift → api/src/index.js
- `loader()` --calls--> `getCurrentUser()`  [EXTRACTED]
  remix/app/routes/register.tsx → remix/app/api/utils/auth/getCurrentUser.ts
- `loader()` --calls--> `getCurrentUser()`  [EXTRACTED]
  remix/app/routes/welcome.tsx → remix/app/api/utils/auth/getCurrentUser.ts
- `ReactiveNav()` --references--> `react`  [EXTRACTED]
  remix/app/components/Nav/ReactiveNav.tsx → remix/package.json
- `ReactiveRightNav()` --references--> `react`  [EXTRACTED]
  remix/app/components/Nav/ReactiveRightNav.tsx → remix/package.json

## Import Cycles
- 1-file cycle: `remix/app/api/utils/mongodb/mongodb.ts -> remix/app/api/utils/mongodb/mongodb.ts`
- 3-file cycle: `remix/app/Providers/ThingtimeProvider.tsx -> remix/app/hooks/useThingtimeMachine.tsx -> remix/app/components/Thingtime/useThingtime.tsx -> remix/app/Providers/ThingtimeProvider.tsx`

## Communities (102 total, 23 thin omitted)

### Community 0 - "utils.ts"
Cohesion: 0.06
Nodes (77): Command(), convertFormats, formats, openNewFinderWindow(), regexToReplacementConverter(), regexTrim(), FORMATS, Command() (+69 more)

### Community 1 - "registerUser.ts"
Cohesion: 0.06
Nodes (69): authCookie, clearAuthCookie(), getAuthToken(), serializeAuthCookie(), shouldShowDevVerificationLink(), SendArgs, sendEmail(), sendVerificationEmail() (+61 more)

### Community 2 - "status.ts"
Cohesion: 0.06
Nodes (69): appendDeploymentIdToDashboardUrl(), clampPercent(), deploymentPageCache, formatBuildPhase(), formatRelativeTime(), getBuildProgressFromChecks(), getCachedJson(), getDashboardOwnerSlug() (+61 more)

### Community 3 - "dependencies"
Cohesion: 0.04
Nodes (44): author, bugs, url, dependencies, axios, bcrypt, body-parser, cors (+36 more)

### Community 4 - "dependencies"
Cohesion: 0.04
Nodes (46): dependencies, @anthropic-ai/sdk, axios, bcrypt, @chakra-ui/react, @chakra-ui/react-types, draft-js, @editorjs/editorjs (+38 more)

### Community 5 - "devDependencies"
Cohesion: 0.05
Nodes (42): devDependencies, @emotion/styled, eslint, eslint-config-prettier, eslint-loader, eslint-plugin-chakra-ui, eslint-plugin-hydrogen, eslint-plugin-prettier (+34 more)

### Community 6 - "package.json"
Cohesion: 0.05
Nodes (38): author, categories, commands, contributors, dependencies, fuse.js, mathjs, @raycast/api (+30 more)

### Community 7 - "getConnection"
Cohesion: 0.07
Nodes (29): mongodb, getUser(), getClient(), getCollection(), getMongoUri(), sanitiseMongoHost(), getConnection(), getDb() (+21 more)

### Community 8 - "DevKit.tsx"
Cohesion: 0.11
Nodes (20): DevKit(), spin, Icon(), Login(), inputSx, Register(), blink, CONTAINER_STYLE (+12 more)

### Community 9 - "index.tsx"
Cohesion: 0.07
Nodes (16): babelPlugin(), createObjectProperties(), deepForEach(), ee(), epp(), escapeEscapes(), escapePropertyPath(), forEachArray() (+8 more)

### Community 10 - "cryptoTools.server.ts"
Cohesion: 0.13
Nodes (31): base64UrlToBase64(), configuredPublicPem(), CRYPTO_STANDARDS, CryptoStandard, decodeBase64UrlText(), decodeKeyMaterial(), decodeSignature(), decodeText() (+23 more)

### Community 11 - "ThingtimeProvider.tsx"
Cohesion: 0.09
Nodes (26): newTimeline(), PathArray, ThingtimeLine(), Timeline, TimelineEvent, TimelineScaffold, Timemachine, TimemachineScaffold (+18 more)

### Community 12 - "package.json"
Cohesion: 0.08
Nodes (25): author, bugs, url, dependencies, smarts, ts-node, typescript, description (+17 more)

### Community 13 - "generators.ts"
Cohesion: 0.11
Nodes (22): ImageGeneratorActionPanel(), SizeSelectionActionPanel(), applyBasicFilter(), filters, getFilterThumbnail(), initializeFilterScript(), generatePlaceholder(), generatePreview() (+14 more)

### Community 14 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 15 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 16 - "useThingtime"
Cohesion: 0.13
Nodes (17): Submit(), RawResult(), RawResultProps, Splash(), Thingtime(), ThingtimeDemo(), ThingtimeURL(), EverythingTypes (+9 more)

### Community 17 - "musing.ts"
Cohesion: 0.11
Nodes (16): FALLBACK_MUSINGS, ALL_MODES, buildContextLine(), buildUserPrompt(), fetchWeather(), generateLopuMusing(), hasLopuAiProviderConfigured, LopuContext (+8 more)

### Community 18 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, resolveJsonModule (+6 more)

### Community 19 - "package.json"
Cohesion: 0.15
Nodes (12): author, dependencies, speed-test, speedtest-net, description, keywords, license, main (+4 more)

### Community 20 - "GradientPath.js"
Cohesion: 0.19
Nodes (13): averageSegmentJoins(), getData(), outlineStrokes(), strokeToFill(), constructor(), render(), Sample, Segment (+5 more)

### Community 21 - "Image Modification Changelog"
Cohesion: 0.20
Nodes (9): [Create Images, In-Clipboard Modification] - 2023-07-06, [Filters] - 2023-03-22, Image Modification Changelog, [Initial Version] - 2023-02-23, [Localization Fix] - 2023-03-07, [Optimize Images, SVG Conversion, More Filters] - 2023-04-03, [Padding, Bug Fixes] - 2023-03-15, [Strip EXIF Data] - 2024-01-28 (+1 more)

### Community 22 - "raycast-env.d.ts"
Cohesion: 0.20
Nodes (9): Commander, CommanderConvert, CommanderMp4ToMp3, CommanderOpenNewFinderWindow, CommanderRegexToReplacementConverter, CommanderRegexTrim, CommanderTrim, ExtensionPreferences (+1 more)

### Community 23 - "Thingtime.tsx"
Cohesion: 0.17
Nodes (14): commanderArgs, CommanderV1(), CommanderV2(), MagicInput, MagicInputProps, ThingtimeComponentProps, ThingtimeProps, sanitise() (+6 more)

### Community 24 - "crypto.tsx"
Cohesion: 0.12
Nodes (15): ApiResponse, CryptoPage(), CryptoStandard, encodingLabel(), formatJson(), generatedEnvValue(), generatedKeyValue(), JsonOutput() (+7 more)

### Community 25 - "colors.tsx"
Cohesion: 0.13
Nodes (12): ChakraWrapper(), chakras, chakrasDark, chakrasLight, colors, g, greys, ChakraButton (+4 more)

### Community 26 - ".ds-entry.tsx"
Cohesion: 0.10
Nodes (15): TestAPI(), Branding(), Logo(), Attention(), Hamburger(), Editor(), TopSpacing(), Raw() (+7 more)

### Community 27 - ".eslintrc.json"
Cohesion: 0.25
Nodes (7): env, es2020, node, extends, parser, plugins, root

### Community 28 - "Footer.tsx"
Cohesion: 0.18
Nodes (13): MongoConnectionStatus, VercelDeploymentStatus, MongoStatus(), pulse, STATUS_COLORS, spin, StatusRefreshButton(), getDisplayPhase() (+5 more)

### Community 29 - "Nav.tsx"
Cohesion: 0.21
Nodes (10): Main(), Footer(), Nav(), ProfileDrawer(), RainbowSkeleton(), UserCard(), CurrentUser, useCurrentUser() (+2 more)

### Community 30 - "Image Modification DevLog - A more detailed changelog"
Cohesion: 0.29
Nodes (6): 2023-06-18, 2023-07-05, 2023-07-06, 2024-01-27, 2024-01-28, Image Modification DevLog - A more detailed changelog

### Community 31 - "optIn"
Cohesion: 0.18
Nodes (16): addOpt(), anyOptsIn(), anyThingsIn(), optIn(), optIndex(), optsIn(), popOpt(), popOpts() (+8 more)

### Community 32 - "root.tsx"
Cohesion: 0.20
Nodes (10): Session, GlobalStyles(), useIcons(), App(), Document, DocumentProps, getDeploymentBranchName(), loader() (+2 more)

### Community 33 - "Setup for Forks"
Cohesion: 0.15
Nodes (12): Auth and Lopu AI, 💹 Donate on Indiegogo to save humanity 🩷, Force Push ? 👉👈, MongoDB, Native iOS TestFlight web URL, Or Donate on GoFundMe 💖, Public env exposure rule, Remix app (+4 more)

### Community 34 - "Coordinator"
Cohesion: 0.08
Nodes (24): app, io, server, smarts, Context, ThingtimeApp, ThingtimeWebView, Coordinator (+16 more)

### Community 35 - "react"
Cohesion: 0.24
Nodes (8): Rainbow(), RainbowText(), TextAnimation1(), useProps(), useTrace(), useUuid(), Index(), react

### Community 36 - "createContext"
Cohesion: 0.19
Nodes (13): addBindingsToContext(), context(), contextObject(), createContext(), createInlineContext(), getNodeUUID(), getPathUUID(), initBlock() (+5 more)

### Community 37 - "Image Modification"
Cohesion: 0.50
Nodes (3): Commands, Features, Image Modification

### Community 38 - "Remix"
Cohesion: 0.50
Nodes (3): Deploy Your Own, Development, Remix

### Community 39 - "entry.server.tsx"
Cohesion: 0.24
Nodes (9): createEmotionServerInstance, EmotionServerFactory, getExport(), handleRequest(), resolveEmotionServerFactory(), ClientStyleContext, ClientStyleContextData, EmotionStyleData (+1 more)

### Community 40 - "package.json"
Cohesion: 0.20
Nodes (9): author, description, license, main, name, scripts, test, type (+1 more)

### Community 41 - "nativeBridge.ts"
Cohesion: 0.33
Nodes (7): NativeBridgeHost(), getNativeBridge(), isNativeBridgeAvailable(), postNativeBridgeMessage(), ThingtimeBridgeMessage, ThingtimeNativeBridge, Window

### Community 42 - "parse"
Cohesion: 0.25
Nodes (9): createScopedEval(), load(), parse(), parser(), play(), primitives(), revive(), safeparse() (+1 more)

### Community 43 - "parsePropertyPath"
Cohesion: 0.25
Nodes (9): deletesmart(), getsmart(), parsePropertyArray(), parsePropertyPath(), pathToArray(), pathToString(), ppa(), ppp() (+1 more)

### Community 44 - "AGENTS.md"
Cohesion: 0.50
Nodes (3): Codex workspace notes, Delivery messaging, graphify

### Community 45 - "entry.client.tsx"
Cohesion: 0.43
Nodes (6): ClientCacheProvider(), createEmotionCache(), defaultEmotionCache, EmotionCacheFactory, getExport(), resolveEmotionCacheFactory()

### Community 46 - "thingIn"
Cohesion: 0.29
Nodes (8): getThing(), popThing(), pushThing(), pushThings(), setThing(), setThings(), thingIn(), thingIndex()

### Community 47 - "stringify"
Cohesion: 0.32
Nodes (8): pause(), replacer(), safestring(), save(), serialize(), setKnown(), stringifier(), stringify()

### Community 48 - "iOS"
Cohesion: 0.29
Nodes (6): Available Actions, Installation, iOS, ios beta, ios build, ios generate

### Community 49 - "CLAUDE.md"
Cohesion: 0.50
Nodes (3): Fundamentals (read first), graphify, Shared agent instructions

### Community 53 - "WebP Codec"
Cohesion: 0.29
Nodes (6): APIs, Bugs, Discuss, Encoding and Decoding Tools, Files, WebP Codec

### Community 54 - "merge"
Cohesion: 0.33
Nodes (7): basic(), clone(), create(), dupe(), merge(), mergeall(), schema()

### Community 55 - "ensure-bcrypt-binding.js"
Cohesion: 0.29
Nodes (5): initial, install, path, repaired, { spawnSync }

### Community 56 - "Safe.tsx"
Cohesion: 0.70
Nodes (3): Safe(), getMeta(), safe()

### Community 60 - "sessions.ts"
Cohesion: 0.50
Nodes (3): { getSession, commitSession, destroySession }, SessionData, SessionFlashData

### Community 74 - "Codex workspace notes"
Cohesion: 0.29
Nodes (6): Codex workspace notes, GitHub push / PR publishing, Graphify, Package manager notes, Remix linting, TypeScript checks

### Community 75 - "03 — Auth: Login / Register / Sessions / JWT 🟢"
Cohesion: 0.05
Nodes (38): 01 — MongoDB Connection Status ✅, Goal, Possible follow-ups (nice-to-have), Verified, What exists, 02 — DB Populate / Seeding 🟡, Acceptance criteria, Decisions (locked — see FUNDAMENTALS.md) (+30 more)

### Community 77 - "rules"
Cohesion: 0.25
Nodes (7): extends, root, rules, no-unused-vars, @typescript-eslint/no-unused-vars, unused-imports/no-unused-imports, unused-imports/no-unused-vars

### Community 78 - "[Unreleased]"
Cohesion: 0.07
Nodes (25): [1.0.0] - YYYY-MM-DD, Added, Changed, Changed, Changelog, Fixed, Fixed, PR #13 - Remix Hydration, Vercel Status, And Deployment Hygiene (+17 more)

### Community 79 - "Thingtime iOS"
Cohesion: 0.40
Nodes (4): Build And Test, Setup, TestFlight Upload, Thingtime iOS

### Community 81 - "🏛️ Thingtime Fundamentals"
Cohesion: 0.22
Nodes (8): 1. The API is the only gateway to data, 2. Seed and test through the real API (functionality cohesion) ⭐, 3. One database: `thingtime`, 4. One MongoDB connection source, 5. Auth = httpOnly cookie + revocable JWT + Mongo session, 6. Never leak secrets, 7. One notification: Lopu 🦄, 🏛️ Thingtime Fundamentals

### Community 86 - "Thingtime"
Cohesion: 0.06
Nodes (9): Foundation, Any, String, URL, ThingtimeWebDestination, ThingtimeWebDestinationTests, Thingtime, XCTest (+1 more)

### Community 88 - "PR 12 review actions"
Cohesion: 0.33
Nodes (5): 1. JWT secret fallback, 2. Production source maps, 3. Atomic email verification token consumption, 4. Unused imports, PR 12 review actions

### Community 90 - "Nikolaj Frey — Engineer Decisions"
Cohesion: 0.40
Nodes (4): Decision log, Decisions, Nikolaj Frey — Engineer Decisions, Recurring principles (the thinking method)

### Community 104 - "Thingtime iOS Agent Runbook"
Cohesion: 0.50
Nodes (3): Apple Developer And TestFlight Flow, Common Command, Thingtime iOS Agent Runbook

## Knowledge Gaps
- **518 isolated node(s):** `extends`, `name`, `version`, `description`, `main` (+513 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `react` to `root.tsx`, `status.ts`, `dependencies`, `DevKit.tsx`, `nativeBridge.ts`, `ThingtimeProvider.tsx`, `entry.client.tsx`, `useThingtime`, `Thingtime.tsx`, `.ds-entry.tsx`, `Footer.tsx`, `Nav.tsx`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `react`, `devDependencies`, `getConnection`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `getConnection`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `extends`, `name`, `version` to the rest of the system?**
  _518 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06349945660611707 - nodes in this community are weakly interconnected._
- **Should `registerUser.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05903866248693835 - nodes in this community are weakly interconnected._
- **Should `status.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05777345017851347 - nodes in this community are weakly interconnected._