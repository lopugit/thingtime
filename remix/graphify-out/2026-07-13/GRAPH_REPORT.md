# Graph Report - remix  (2026-07-07)

## Corpus Check
- 220 files · ~190,022 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1202 nodes · 2371 edges · 79 communities (59 shown, 20 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 117 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `819126bf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_registerUser.ts|registerUser.ts]]
- [[_COMMUNITY_json|json]]
- [[_COMMUNITY_status.ts|status.ts]]
- [[_COMMUNITY_statusTarget.ts|statusTarget.ts]]
- [[_COMMUNITY_Landing.tsx|Landing.tsx]]
- [[_COMMUNITY_devDependencies|devDependencies]]
- [[_COMMUNITY_dependencies|dependencies]]
- [[_COMMUNITY_getConnection|getConnection]]
- [[_COMMUNITY_index.tsx|index.tsx]]
- [[_COMMUNITY_cryptoTools.server.ts|cryptoTools.server.ts]]
- [[_COMMUNITY_root.tsx|root.tsx]]
- [[_COMMUNITY_ThingtimeProvider.tsx|ThingtimeProvider.tsx]]
- [[_COMMUNITY_tests.tsx|tests.tsx]]
- [[_COMMUNITY_useThingtime|useThingtime]]
- [[_COMMUNITY_musing.ts|musing.ts]]
- [[_COMMUNITY_GradientPath.js|GradientPath.js]]
- [[_COMMUNITY_ThemeStudio.tsx|ThemeStudio.tsx]]
- [[_COMMUNITY_vercel.tsx|vercel.tsx]]
- [[_COMMUNITY_Thingtime.tsx|Thingtime.tsx]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_crypto.tsx|crypto.tsx]]
- [[_COMMUNITY_Unreleased|[Unreleased]]]
- [[_COMMUNITY_routes.tsx|routes.tsx]]
- [[_COMMUNITY_DrawerContent.tsx|DrawerContent.tsx]]
- [[_COMMUNITY_colors.tsx|colors.tsx]]
- [[_COMMUNITY_root-data.server.ts|root-data.server.ts]]
- [[_COMMUNITY_optIn|optIn]]
- [[_COMMUNITY_CommanderV2.tsx|CommanderV2.tsx]]
- [[_COMMUNITY_entry.client.tsx|entry.client.tsx]]
- [[_COMMUNITY_DevKit.tsx|DevKit.tsx]]
- [[_COMMUNITY_createContext|createContext]]
- [[_COMMUNITY_rules|rules]]
- [[_COMMUNITY_useApi|useApi]]
- [[_COMMUNITY_ode.tsx|ode.tsx]]
- [[_COMMUNITY_useLopu.tsx|useLopu.tsx]]
- [[_COMMUNITY_DesignWorkspace.tsx|DesignWorkspace.tsx]]
- [[_COMMUNITY_DocsLayout.tsx|DocsLayout.tsx]]
- [[_COMMUNITY_useCurrentUser|useCurrentUser]]
- [[_COMMUNITY_verify-vercel-output.mjs|verify-vercel-output.mjs]]
- [[_COMMUNITY_nativeBridge.ts|nativeBridge.ts]]
- [[_COMMUNITY_parse|parse]]
- [[_COMMUNITY_parsePropertyPath|parsePropertyPath]]
- [[_COMMUNITY_thingIn|thingIn]]
- [[_COMMUNITY_stringify|stringify]]
- [[_COMMUNITY_designEntries.ts|designEntries.ts]]
- [[_COMMUNITY_merge|merge]]
- [[_COMMUNITY_ensure-bcrypt-binding.js|ensure-bcrypt-binding.js]]
- [[_COMMUNITY_sessions.ts|sessions.ts]]
- [[_COMMUNITY_patch-vercel-output.mjs|patch-vercel-output.mjs]]
- [[_COMMUNITY_Safe.tsx|Safe.tsx]]
- [[_COMMUNITY_dev.mjs|dev.mjs]]
- [[_COMMUNITY_....ts|[...].ts]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_vite.config.ts|vite.config.ts]]
- [[_COMMUNITY_Remix|Remix]]
- [[_COMMUNITY_global-types.d.ts|global-types.d.ts]]
- [[_COMMUNITY_manifest.json|manifest.json]]
- [[_COMMUNITY_app.env.d.ts|app.env.d.ts]]
- [[_COMMUNITY_pre-dev.sh|pre-dev.sh]]
- [[_COMMUNITY_vercel.sh script|vercel.sh script]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_getConnectionAction|getConnectionAction]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_populateAction|populateAction]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_rawResultsAction|rawResultsAction]]
- [[_COMMUNITY_action|action]]
- [[_COMMUNITY_loader|loader]]

## God Nodes (most connected - your core abstractions)
1. `json()` - 49 edges
2. `useThingtime()` - 46 edges
3. `getVercelDeploymentStatus()` - 26 edges
4. `getCurrentUser()` - 20 edges
5. `useCurrentUser()` - 20 edges
6. `useDrawer()` - 18 edges
7. `useApi()` - 18 edges
8. `compilerOptions` - 18 edges
9. `scripts` - 17 edges
10. `[Unreleased]` - 16 edges

## Surprising Connections (you probably didn't know these)
- `loader()` --calls--> `json()`  [EXTRACTED]
  app/routes/api/v1/crypto/_crypto.tsx → app/api/http.ts
- `DemoSection()` --calls--> `useThingtime()`  [EXTRACTED]
  app/components/Landing/Landing.tsx → app/components/Thingtime/useThingtime.tsx
- `Index()` --calls--> `useThingtime()`  [INFERRED]
  app/routes/$.tsx → app/components/Thingtime/useThingtime.tsx
- `rootDataResponse()` --calls--> `json()`  [EXTRACTED]
  app/root-data.server.ts → app/api/http.ts
- `loader()` --calls--> `json()`  [EXTRACTED]
  app/routes/api/v1/auth/jwks/_jwks.tsx → app/api/http.ts

## Import Cycles
- 1-file cycle: `app/api/utils/mongodb/mongodb.ts -> app/api/utils/mongodb/mongodb.ts`
- 1-file cycle: `app/routes.tsx -> app/routes.tsx`
- 3-file cycle: `app/Providers/ThingtimeProvider.tsx -> app/hooks/useThingtimeMachine.tsx -> app/components/Thingtime/useThingtime.tsx -> app/Providers/ThingtimeProvider.tsx`

## Communities (79 total, 20 thin omitted)

### Community 0 - "registerUser.ts"
Cohesion: 0.05
Nodes (73): redirect(), authCookie, clearAuthCookie(), getAuthToken(), serializeAuthCookie(), shouldShowDevVerificationLink(), SendArgs, sendEmail() (+65 more)

### Community 1 - "json"
Cohesion: 0.06
Nodes (54): json(), JsonInit, setUserActiveTheme(), activeRequestsExpr(), consumeLopuMusingQuota(), firstHeaderIp(), getRequestIp(), hashIp() (+46 more)

### Community 2 - "status.ts"
Cohesion: 0.09
Nodes (49): appendDeploymentIdToDashboardUrl(), clampPercent(), deploymentPageCache, formatBuildPhase(), formatRelativeTime(), getBuildProgressFromChecks(), getCachedJson(), getDashboardOwnerSlug() (+41 more)

### Community 3 - "statusTarget.ts"
Cohesion: 0.08
Nodes (43): BasicServiceHealthStatus, configuredOrigins(), fetchWithTimeout(), getRequestOrigin(), isAllowedStatusOrigin(), LOCAL_STATUS_PORTS, normaliseOrigin(), resolveStatusTarget() (+35 more)

### Community 4 - "Landing.tsx"
Cohesion: 0.05
Nodes (21): Branding(), Logo(), Attention(), Hamburger(), BrutalButton(), BrutalVariant, burstAtEvent(), burstConfetti() (+13 more)

### Community 5 - "devDependencies"
Cohesion: 0.04
Nodes (47): devDependencies, @emotion/styled, eslint, eslint-config-prettier, eslint-loader, eslint-plugin-chakra-ui, eslint-plugin-hydrogen, eslint-plugin-prettier (+39 more)

### Community 6 - "dependencies"
Cohesion: 0.05
Nodes (44): dependencies, @anthropic-ai/sdk, axios, bcrypt, @chakra-ui/react, @chakra-ui/react-types, draft-js, @editorjs/editorjs (+36 more)

### Community 7 - "getConnection"
Cohesion: 0.10
Nodes (21): getUser(), getClient(), getCollection(), getConnection(), getDb(), getMongoDb(), getObjectId(), userCheckExists() (+13 more)

### Community 8 - "index.tsx"
Cohesion: 0.07
Nodes (16): babelPlugin(), createObjectProperties(), deepForEach(), ee(), epp(), escapeEscapes(), escapePropertyPath(), forEachArray() (+8 more)

### Community 9 - "cryptoTools.server.ts"
Cohesion: 0.13
Nodes (32): base64UrlToBase64(), configuredPublicPem(), CRYPTO_STANDARDS, CryptoStandard, decodeBase64UrlText(), decodeKeyMaterial(), decodeSignature(), decodeText() (+24 more)

### Community 10 - "root.tsx"
Cohesion: 0.16
Nodes (22): Main(), DrawerContent(), DrawerSystem(), DrawerSystemInner(), DrawerTrigger(), NavDrawer(), NavDrawerProps, AccountModalContext (+14 more)

### Community 11 - "ThingtimeProvider.tsx"
Cohesion: 0.09
Nodes (27): newTimeline(), PathArray, ThingtimeLine(), Timeline, TimelineEvent, TimelineScaffold, Timemachine, TimemachineScaffold (+19 more)

### Community 12 - "tests.tsx"
Cohesion: 0.10
Nodes (22): createApiTestContext(), createInitialPayloadTexts(), ResultMap, RunOptions, ApiTestContext, ApiTestDefinition, ApiTestExpectation, ApiTestGroup (+14 more)

### Community 13 - "useThingtime"
Cohesion: 0.13
Nodes (17): Submit(), RawResult(), RawResultProps, RawResults(), ThingtimeURL(), EverythingTypes, ThingtimeTypes, useThingtime() (+9 more)

### Community 14 - "musing.ts"
Cohesion: 0.11
Nodes (16): FALLBACK_MUSINGS, ALL_MODES, buildContextLine(), buildUserPrompt(), fetchWeather(), generateLopuMusing(), hasLopuAiProviderConfigured, LopuContext (+8 more)

### Community 15 - "GradientPath.js"
Cohesion: 0.19
Nodes (13): averageSegmentJoins(), getData(), outlineStrokes(), strokeToFill(), constructor(), render(), Sample, Segment (+5 more)

### Community 16 - "ThemeStudio.tsx"
Cohesion: 0.13
Nodes (11): ColorControl(), isHexColor(), curatedFontNames, STATIC_FONTS, ThemeHost(), COLOR_FIELDS, sectionHeaderStyle, ThemePreviewCard (+3 more)

### Community 17 - "vercel.tsx"
Cohesion: 0.12
Nodes (15): VercelDeploymentsOverview, VercelDeploymentSummary, BRANCH_LIMIT_OPTIONS, buildDefaultSelectedStates(), buildStatusOptions(), dateLabel(), DeploymentRow(), DeploymentSort (+7 more)

### Community 18 - "Thingtime.tsx"
Cohesion: 0.20
Nodes (13): commanderArgs, CommanderV1(), Icon(), inputSx, MagicInput, MagicInputProps, SettingsMenu(), Thingtime() (+5 more)

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+12 more)

### Community 20 - "crypto.tsx"
Cohesion: 0.12
Nodes (15): ApiResponse, CryptoPage(), CryptoStandard, encodingLabel(), formatJson(), generatedEnvValue(), generatedKeyValue(), JsonOutput() (+7 more)

### Community 21 - "[Unreleased]"
Cohesion: 0.11
Nodes (18): [1.0.0] - YYYY-MM-DD, Added, Added, Added, Changed, Changed, Changed, Changed (+10 more)

### Community 22 - "routes.tsx"
Cohesion: 0.16
Nodes (10): fetchRemoteJson(), DocsDesign(), config, Edge(), fetchJson(), login(), register(), rootLoader() (+2 more)

### Community 23 - "DrawerContent.tsx"
Cohesion: 0.15
Nodes (14): DrawerContentProps, UserAvatarCircle(), applyDrawerOrdering(), buildDrawerSubSections(), drawerMenuItems, DrawerSubItem, DrawerSubSection, DrawerTopItem (+6 more)

### Community 24 - "colors.tsx"
Cohesion: 0.14
Nodes (11): ChakraWrapper(), chakras, chakrasDark, chakrasLight, colors, g, greys, ChakraButton (+3 more)

### Community 25 - "root-data.server.ts"
Cohesion: 0.17
Nodes (8): CookieOptions, createCookie(), Session, getDeploymentBranchName(), loadRootData(), rootDataResponse(), RootLoaderData, shouldShowDeploymentStatus()

### Community 26 - "optIn"
Cohesion: 0.18
Nodes (16): addOpt(), anyOptsIn(), anyThingsIn(), optIn(), optIndex(), optsIn(), popOpt(), popOpts() (+8 more)

### Community 27 - "CommanderV2.tsx"
Cohesion: 0.22
Nodes (8): CommanderV2(), Rainbow(), sanitise(), usePath(), useProps(), useTrace(), useUuid(), getParentPath()

### Community 28 - "entry.client.tsx"
Cohesion: 0.19
Nodes (12): ClientCacheProvider(), root, createEmotionCache(), defaultEmotionCache, EmotionCacheFactory, getExport(), resolveEmotionCacheFactory(), ClientStyleContext (+4 more)

### Community 29 - "DevKit.tsx"
Cohesion: 0.27
Nodes (12): clamp(), clampPanelPosition(), clampTriggerPosition(), FixedPosition, getDevKitBottomGuard(), getDevKitRightGuard(), getViewportSize(), isNativeWebView() (+4 more)

### Community 30 - "createContext"
Cohesion: 0.19
Nodes (13): addBindingsToContext(), context(), contextObject(), createContext(), createInlineContext(), getNodeUUID(), getPathUUID(), initBlock() (+5 more)

### Community 31 - "rules"
Cohesion: 0.15
Nodes (12): extends, root, rules, import/no-duplicates, no-eval, no-unused-vars, @typescript-eslint/no-extra-semi, @typescript-eslint/no-unused-expressions (+4 more)

### Community 32 - "useApi"
Cohesion: 0.27
Nodes (8): DevKit(), Hero(), Login(), inputSx, Register(), useLopu(), useApi(), Profile()

### Community 33 - "ode.tsx"
Cohesion: 0.24
Nodes (5): RainbowText(), Splash(), TextAnimation1(), ThingtimeDemo(), Index()

### Community 34 - "useLopu.tsx"
Cohesion: 0.20
Nodes (8): CONTAINER_STYLE, drain, LopuArgs, LopuLink, LopuStatus, LopuToast(), statusEmoji(), useLopuStream()

### Community 35 - "DesignWorkspace.tsx"
Cohesion: 0.22
Nodes (9): designKindColors, getDesignEntryPreviewSrc(), DesignWorkspace(), DesignWorkspaceProps, FrameWidthKey, frameWidthPresets, DocsOutletContext, PreviewFrame() (+1 more)

### Community 36 - "DocsLayout.tsx"
Cohesion: 0.24
Nodes (8): getDesignEntryBySlug(), DocsDrawerContent(), DocsDrawerContentProps, DocsLayout(), docsNav, DrawerDesignEntryList(), DrawerDesignEntryListProps, isDesignPath()

### Community 37 - "useCurrentUser"
Cohesion: 0.40
Nodes (5): UserCard(), CurrentUser, useCurrentUser(), Welcome(), RAINBOW_VARS

### Community 38 - "verify-vercel-output.mjs"
Cohesion: 0.20
Nodes (8): apiIndex, config, filesystemIndex, hasFilesystemRoute, indexHtml, rootIndex, serverFallbackIndex, spaIndex

### Community 39 - "nativeBridge.ts"
Cohesion: 0.33
Nodes (7): NativeBridgeHost(), getNativeBridge(), isNativeBridgeAvailable(), postNativeBridgeMessage(), ThingtimeBridgeMessage, ThingtimeNativeBridge, Window

### Community 40 - "parse"
Cohesion: 0.25
Nodes (9): createScopedEval(), load(), parse(), parser(), play(), primitives(), revive(), safeparse() (+1 more)

### Community 41 - "parsePropertyPath"
Cohesion: 0.25
Nodes (9): deletesmart(), getsmart(), parsePropertyArray(), parsePropertyPath(), pathToArray(), pathToString(), ppa(), ppp() (+1 more)

### Community 42 - "thingIn"
Cohesion: 0.29
Nodes (8): getThing(), popThing(), pushThing(), pushThings(), setThing(), setThings(), thingIn(), thingIndex()

### Community 43 - "stringify"
Cohesion: 0.32
Nodes (8): pause(), replacer(), safestring(), save(), serialize(), setKnown(), stringifier(), stringify()

### Community 44 - "designEntries.ts"
Cohesion: 0.33
Nodes (4): designEntries, DesignEntry, DesignEntryKind, referenceLinks

### Community 45 - "merge"
Cohesion: 0.33
Nodes (7): basic(), clone(), create(), dupe(), merge(), mergeall(), schema()

### Community 46 - "ensure-bcrypt-binding.js"
Cohesion: 0.29
Nodes (5): initial, install, path, repaired, { spawnSync }

### Community 48 - "patch-vercel-output.mjs"
Cohesion: 0.33
Nodes (5): apiCatchAllRoute, apiRootDataRoute, config, filesystemRoute, serverFallbackRoute

### Community 49 - "Safe.tsx"
Cohesion: 0.70
Nodes (3): Safe(), getMeta(), safe()

### Community 50 - "dev.mjs"
Cohesion: 0.50
Nodes (3): children, loadLocalEnv(), parseEnvValue()

### Community 52 - "vercel.json"
Cohesion: 0.40
Nodes (4): buildCommand, framework, installCommand, $schema

### Community 54 - "Remix"
Cohesion: 0.50
Nodes (3): Deploy Your Own, Development, Remix

## Knowledge Gaps
- **332 isolated node(s):** `root`, `extends`, `@typescript-eslint/no-extra-semi`, `@typescript-eslint/no-use-before-define`, `@typescript-eslint/no-unused-expressions` (+327 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `json()` connect `json` to `registerUser.ts`, `status.ts`, `statusTarget.ts`, `cryptoTools.server.ts`, `root-data.server.ts`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `statusTarget.ts`, `devDependencies`, `getConnection`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `useThingtime()` connect `useThingtime` to `useApi`, `ode.tsx`, `Landing.tsx`, `getConnection`, `root.tsx`, `ThingtimeProvider.tsx`, `ThemeStudio.tsx`, `Thingtime.tsx`, `CommanderV2.tsx`, `DevKit.tsx`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **What connects `root`, `extends`, `@typescript-eslint/no-extra-semi` to the rest of the system?**
  _332 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `registerUser.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.054199328107502796 - nodes in this community are weakly interconnected._
- **Should `json` be split into smaller, more focused modules?**
  _Cohesion score 0.06127206127206127 - nodes in this community are weakly interconnected._
- **Should `status.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08874912648497554 - nodes in this community are weakly interconnected._