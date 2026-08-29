#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";

import {
  LABEL_DEFINITIONS,
  classifyInventory,
  formatZonedTimestamp,
  labelDelta,
  renderContext,
  summarizeBatch,
} from "./lopu-pr-status.mjs";

test("time conversion is UTC-first and daylight-saving aware", () => {
  const august = Date.parse("2026-08-29T03:20:00Z") / 1000;
  assert.equal(formatZonedTimestamp(august, "UTC"), "2026-08-29 03:20 UTC (UTC+00:00)");
  assert.equal(
    formatZonedTimestamp(august, "America/Los_Angeles"),
    "2026-08-28 20:20 PDT (UTC-07:00)",
  );
  assert.equal(
    formatZonedTimestamp(august, "Australia/Melbourne"),
    "2026-08-29 13:20 AEST (UTC+10:00)",
  );

  const january = Date.parse("2027-01-15T03:20:00Z") / 1000;
  assert.match(formatZonedTimestamp(january, "America/Los_Angeles"), /PST \(UTC-08:00\)$/u);
  assert.match(formatZonedTimestamp(january, "Australia/Melbourne"), /AEDT \(UTC\+11:00\)$/u);
});

test("classification separates roots, stacks, missing parents, file overlap, and branch state", () => {
  const result = classifyInventory(
    [
      {
        number: 1,
        headRefName: "feature-parent",
        baseRefName: "develop",
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        files: ["src/shared.ts", "src/parent.ts"],
      },
      {
        number: 2,
        headRefName: "feature-child",
        baseRefName: "feature-parent",
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
        files: ["src/shared.ts", "src/child.ts"],
      },
      {
        number: 3,
        headRefName: "orphan-child",
        baseRefName: "closed-parent-branch",
        mergeable: "MERGEABLE",
        mergeStateStatus: "BEHIND",
        files: ["src/orphan.ts"],
      },
      {
        number: 4,
        headRefName: "fork-draft",
        baseRefName: "develop",
        isCrossRepository: true,
        isDraft: true,
        mergeable: "UNKNOWN",
        mergeStateStatus: "UNKNOWN",
        files: [],
      },
    ],
    { defaultRef: "main" },
  );

  assert.deepEqual(result.stats, {
    open: 4,
    conflicting: 1,
    outdated: 1,
    mergeable: 1,
    unknown: 1,
    stackMembers: 2,
    targetPrNotOpen: 1,
    overlappingPrs: 2,
    overlapPairs: 1,
    drafts: 1,
    forks: 1,
    filesCapped: 0,
  });
  const parent = result.prs.find(({ number }) => number === 1);
  const child = result.prs.find(({ number }) => number === 2);
  const orphan = result.prs.find(({ number }) => number === 3);
  const forkDraft = result.prs.find(({ number }) => number === 4);
  assert.deepEqual(parent.children, [2]);
  assert.deepEqual(parent.overlapPrNumbers, [2]);
  assert.deepEqual(child.parents, [1]);
  assert.deepEqual(child.desiredFactLabels, [
    "lopu: conflicting",
    "lopu: part of stack",
    "lopu: overlapping files",
  ]);
  assert.equal(orphan.targetMissing, true);
  assert.deepEqual(orphan.desiredFactLabels, ["lopu: out-of-date", "lopu: target PR not open"]);
  assert.deepEqual(forkDraft.desiredFactLabels, ["lopu: unknown state", "lopu: fork", "lopu: draft"]);
});

test("rendered context shows UTC conversions, queue counts, and related PRs", () => {
  const rendered = renderContext({
    nowEpoch: Date.parse("2026-08-29T03:20:00Z") / 1000,
    etaMinutes: 20,
    stats: {
      open: 44,
      conflicting: 22,
      outdated: 3,
      unknown: 1,
      stackMembers: 4,
      overlappingPrs: 8,
      targetPrNotOpen: 2,
    },
    batch: { total: 7, resolving: 1, queued: 5, done: 1 },
    relationships: {
      parents: [465],
      children: [470],
      targetRoot: false,
      targetMissing: false,
      overlapPrNumbers: [68, 291],
      sharedFileCount: 3,
    },
    repo: "lopugit/thingtime",
    base: "feature-parent",
    head: "feature-child",
  });
  assert.match(rendered, /Time conversion \(UTC source\)/u);
  assert.match(rendered, /PDT \(UTC-07:00\)/u);
  assert.match(rendered, /AEST \(UTC\+10:00\)/u);
  assert.match(rendered, /\| This resolver batch \| Currently resolving \| 1 \|/u);
  assert.match(rendered, /\[#68\].*\[#291\]/u);
  assert.match(rendered, /3 changed files are also touched/u);
});

test("the managed namespace contains fact and lane labels only", () => {
  assert.equal(new Set(LABEL_DEFINITIONS.map(({ name }) => name)).size, LABEL_DEFINITIONS.length);
  assert.ok(LABEL_DEFINITIONS.every(({ name }) => name.startsWith("lopu: ")));
  assert.deepEqual(
    LABEL_DEFINITIONS.filter(({ scope }) => scope === "lane").map(({ name }) => name),
    ["lopu: queued", "lopu: resolving", "lopu: needs attention"],
  );
});

test("label reconciliation changes only its managed subset", () => {
  assert.deepEqual(
    labelDelta({
      current: ["enhancement", "lopu: queued", "lopu: conflicting"],
      managed: ["lopu: queued", "lopu: resolving", "lopu: needs attention"],
      desired: ["lopu: resolving"],
    }),
    { add: ["lopu: resolving"], remove: ["lopu: queued"] },
  );
});

test("batch counts follow exact matrix worker names", () => {
  assert.deepEqual(
    summarizeBatch(
      [{ number: 10 }, { number: 68 }, { number: 291 }, { number: 367 }],
      [
        { name: "Resolve PR #10", status: "queued" },
        { name: "Resolve PR #68", status: "in_progress" },
        { name: "Resolve PR #291", status: "completed" },
        { name: "Resolve PR #999", status: "in_progress" },
      ],
    ),
    { total: 4, resolving: 1, queued: 2, done: 1 },
  );
});
