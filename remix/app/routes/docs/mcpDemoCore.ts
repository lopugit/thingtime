export type McpDemoStep = {
  tool: string;
  title: string;
  detail: string;
  boundary: 'read' | 'compose' | 'confirm' | 'recover';
};

export type McpDemoScenario = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  prompt: string;
  result: string;
  steps: McpDemoStep[];
};

export type McpDemoSnapshot = {
  serverVersion: string;
  toolCount: number;
  promptCount: number;
  resourceCount: number;
  resourceTemplateCount: number;
  featureCount: number;
  operationCount: number;
};

export const MCP_DEMO_FALLBACK_SNAPSHOT: McpDemoSnapshot = {
  serverVersion: '1.3.0',
  toolCount: 31,
  promptCount: 5,
  resourceCount: 2,
  resourceTemplateCount: 4,
  featureCount: 14,
  operationCount: 36
};

export const mcpDemoScenarios: McpDemoScenario[] = [
  {
    id: 'morning-command-centre',
    eyebrow: 'Read + relate',
    title: 'Morning command centre',
    summary: 'Turn scattered Things into one grounded priority briefing without changing the account.',
    prompt:
      'Use my selected Thingtime account. Find my active priorities, follow their related projects and recent comments, then give me a five-item morning brief. Do not change anything.',
    result: 'A contextual brief with direct Thing references, relationship context, and no write side effects.',
    steps: [
      {
        tool: 'select_thingtime_account',
        title: 'Lock the account',
        detail: 'Resolve one named connection before touching account data.',
        boundary: 'read'
      },
      {
        tool: 'search_thingtime_things',
        title: 'Find the signal',
        detail: 'Search broadly for active priorities instead of guessing IDs.',
        boundary: 'read'
      },
      {
        tool: 'list_thingtime_related',
        title: 'Follow context',
        detail: 'Traverse projects, parents, children, backlinks, and threads in bounded reads.',
        boundary: 'read'
      },
      {
        tool: 'list_thingtime_comments',
        title: 'Add recent decisions',
        detail: 'Read atomic comment Things for the exact selected targets.',
        boundary: 'read'
      }
    ]
  },
  {
    id: 'structured-research',
    eyebrow: 'Schema + create',
    title: 'Research into reusable knowledge',
    summary: 'Model a topic, validate it, and preview structured records before anything is created.',
    prompt:
      'Design a private Research Note schema for sources, claims, confidence, and follow-ups. Validate one example, then preview creating three notes from my selected findings. Wait for my confirmation.',
    result: 'A validated schema-shaped plan and a readable before/after review—still unapplied.',
    steps: [
      {
        tool: 'list_thingtime_schemas',
        title: 'Reuse what exists',
        detail: 'Discover compatible schemas before proposing a new shape.',
        boundary: 'read'
      },
      {
        tool: 'validate_thingtime_thing',
        title: 'Prove the shape',
        detail: 'Validate the example against built-in and user-authored schema constraints.',
        boundary: 'compose'
      },
      {
        tool: 'preview_thingtime_mutation',
        title: 'Render the plan',
        detail: 'Assign stable IDs, preflight every operation, and return a signed short-lived receipt.',
        boundary: 'compose'
      },
      {
        tool: 'apply_thingtime_mutation',
        title: 'Wait at the boundary',
        detail: 'Apply only after the reviewed receipt and explicit confirmed=true are both present.',
        boundary: 'confirm'
      }
    ]
  },
  {
    id: 'safe-bulk-cleanup',
    eyebrow: 'Preview + apply',
    title: 'Safe bulk clean-up',
    summary: 'Archive a bounded set of stale Things with exact targets, preconditions, and one review surface.',
    prompt:
      'Find Things tagged inbox that have not changed in 90 days. Show me at most 20 exact matches, preview archiving only those IDs, and do not apply until I confirm the signed plan.',
    result: 'A bounded archive diff that rejects duplicate targets, stale preconditions, and silent scope changes.',
    steps: [
      {
        tool: 'search_thingtime_things',
        title: 'Resolve exact targets',
        detail: 'Produce a reviewable ID set instead of an open-ended query mutation.',
        boundary: 'read'
      },
      {
        tool: 'get_thingtime_things',
        title: 'Snapshot current state',
        detail: 'Fetch exact records and updatedAt preconditions in one bounded batch.',
        boundary: 'read'
      },
      {
        tool: 'preview_thingtime_mutation',
        title: 'Sign the archive diff',
        detail: 'Keep the operation count and payload below hard limits, then sign the exact scope.',
        boundary: 'compose'
      },
      {
        tool: 'apply_thingtime_mutation',
        title: 'Confirm once, apply exactly',
        detail: 'Reject altered, expired, unconfirmed, or wrong-account receipts.',
        boundary: 'confirm'
      }
    ]
  },
  {
    id: 'reusable-capability',
    eyebrow: 'Compose + reuse',
    title: 'Build a reusable capability',
    summary: 'Turn a successful bounded workflow into a schema-backed Capability Thing with explicit inputs.',
    prompt:
      'Build a reusable capability named Close Project. It should accept a project ID, preview marking it complete and archiving up to 10 linked tasks, and always require confirmation.',
    result: 'A portable Capability Thing that expands only registered primitives and explicit $input placeholders.',
    steps: [
      {
        tool: 'get_thingtime_capability_contract',
        title: 'Start from the grammar',
        detail: 'Read the allowed operations, placeholder syntax, depth, node, byte, and operation limits.',
        boundary: 'read'
      },
      {
        tool: 'validate_thingtime_thing',
        title: 'Validate the capability',
        detail: 'Reject arbitrary routes, URLs, database operators, code, and undeclared inputs.',
        boundary: 'compose'
      },
      {
        tool: 'start_thingtime_workflow',
        title: 'Expand deterministically',
        detail: 'Compile declared inputs into a bounded mutation preview rather than executing free-form logic.',
        boundary: 'compose'
      },
      {
        tool: 'apply_thingtime_mutation',
        title: 'Keep human control',
        detail: 'The reusable workflow still cannot cross the signed confirmation boundary by itself.',
        boundary: 'confirm'
      }
    ]
  },
  {
    id: 'change-and-recovery',
    eyebrow: 'Observe + recover',
    title: 'What changed—and undo it',
    summary: 'Poll bounded changes, inspect MCP mutation history, and reverse a prior write with another preview.',
    prompt:
      'Show what changed in this account since yesterday. Separate MCP-applied changes from other updates. Then inspect the latest MCP write and preview undoing it; do not undo yet.',
    result: 'An honest bounded change view plus a reversible, separately confirmed compensation plan.',
    steps: [
      {
        tool: 'list_thingtime_changes',
        title: 'Poll visible changes',
        detail: 'Read bounded updates without pretending to offer a complete deletion event stream.',
        boundary: 'read'
      },
      {
        tool: 'list_thingtime_history',
        title: 'Inspect MCP receipts',
        detail: 'Read encrypted bounded history for writes the MCP actually applied.',
        boundary: 'read'
      },
      {
        tool: 'get_thingtime_history',
        title: 'Review the exact write',
        detail: 'Recover the original before and after state for one history entry.',
        boundary: 'read'
      },
      {
        tool: 'undo_thingtime_mutation',
        title: 'Preview compensation',
        detail: 'Build the reverse operations and require a fresh explicit confirmation before applying them.',
        boundary: 'recover'
      }
    ]
  }
];

const finiteCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export const parseMcpDemoSnapshot = (input: {
  initialize?: unknown;
  tools?: unknown;
  prompts?: unknown;
  resources?: unknown;
  resourceTemplates?: unknown;
  manifest?: unknown;
}): McpDemoSnapshot | null => {
  const initialize = input.initialize as { serverInfo?: { version?: unknown } } | undefined;
  const tools = input.tools as { tools?: unknown[] } | undefined;
  const prompts = input.prompts as { prompts?: unknown[] } | undefined;
  const resources = input.resources as { resources?: unknown[] } | undefined;
  const resourceTemplates = input.resourceTemplates as { resourceTemplates?: unknown[] } | undefined;
  const manifest = input.manifest as { features?: Record<string, unknown>; operations?: unknown[] } | undefined;
  const serverVersion = initialize?.serverInfo?.version;
  const counts = [
    tools?.tools?.length,
    prompts?.prompts?.length,
    resources?.resources?.length,
    resourceTemplates?.resourceTemplates?.length,
    manifest?.features ? Object.keys(manifest.features).length : null,
    manifest?.operations?.length
  ].map(finiteCount);

  if (typeof serverVersion !== 'string' || counts.some((count) => count === null)) {
    return null;
  }

  return {
    serverVersion,
    toolCount: counts[0]!,
    promptCount: counts[1]!,
    resourceCount: counts[2]!,
    resourceTemplateCount: counts[3]!,
    featureCount: counts[4]!,
    operationCount: counts[5]!
  };
};

export const reviewPayloadForScenario = (scenario: McpDemoScenario) => {
  const confirmationRequired = scenario.steps.some((step) => step.boundary !== 'read');

  return {
    account: { id: 'demo-account', label: 'Limitless Lab (demo only)' },
    confirmationRequired,
    ...(confirmationRequired ? { receipt: `demo-signed-receipt:${scenario.id}` } : {}),
    preview: {
      operations: scenario.steps.map((step, index) => ({
        id: `${scenario.id}-${index + 1}`,
        action: step.tool,
        title: step.title,
        description: step.detail,
        before: { status: index === 0 ? 'current' : 'unchanged', demo: true },
        after: {
          status: step.boundary === 'read' ? 'read result' : step.boundary === 'confirm' ? 'awaiting confirmation' : 'previewed',
          demo: true
        }
      }))
    }
  };
};
