#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const ROOT_BRANCHES = new Set([
  "main",
  "master",
  "develop",
  "github-actions",
  "all",
  "lopu-internal-all-branch",
]);

export const LABEL_DEFINITIONS = Object.freeze([
  {
    name: "lopu: conflicting",
    color: "d73a4a",
    description: "GitHub reports merge conflicts for the current PR snapshot",
    scope: "fact",
  },
  {
    name: "lopu: out-of-date",
    color: "fbca04",
    description: "The PR branch is behind its target branch",
    scope: "fact",
  },
  {
    name: "lopu: mergeable",
    color: "0e8a16",
    description: "The PR branches can currently be merged without conflicts",
    scope: "fact",
  },
  {
    name: "lopu: unknown state",
    color: "cfd3d7",
    description: "GitHub is still computing the PR branch state",
    scope: "fact",
  },
  {
    name: "lopu: part of stack",
    color: "5319e7",
    description: "The PR has an open parent or child PR on a non-root branch",
    scope: "fact",
  },
  {
    name: "lopu: target PR not open",
    color: "e99695",
    description: "The PR targets a non-root branch without an open parent PR",
    scope: "fact",
  },
  {
    name: "lopu: overlapping files",
    color: "f9d0c4",
    description: "This PR changes files also changed by another open PR",
    scope: "fact",
  },
  {
    name: "lopu: fork",
    color: "cfd3d7",
    description: "The PR head belongs to a fork and cannot be pushed by Lopu",
    scope: "fact",
  },
  {
    name: "lopu: draft",
    color: "ededed",
    description: "The pull request is currently a draft",
    scope: "fact",
  },
  {
    name: "lopu: queued",
    color: "1d76db",
    description: "The exact PR snapshot is waiting in Lopu's resolver queue",
    scope: "lane",
  },
  {
    name: "lopu: resolving",
    color: "8250df",
    description: "Lopu is actively updating this PR branch",
    scope: "lane",
  },
  {
    name: "lopu: needs attention",
    color: "b60205",
    description: "The latest Lopu attempt stopped and needs review",
    scope: "lane",
  },
]);

const FACT_LABEL_ORDER = LABEL_DEFINITIONS.filter(({ scope }) => scope === "fact").map(
  ({ name }) => name,
);

function uniqueSortedStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string" && value))].sort();
}

function uniqueSortedNumbers(values) {
  return [...new Set((values ?? []).filter(Number.isSafeInteger))].sort((left, right) => left - right);
}

function labelNames(labels) {
  return uniqueSortedStrings(
    (labels ?? []).map((label) => (typeof label === "string" ? label : label?.name)),
  );
}

function normalizePr(pr) {
  if (!Number.isSafeInteger(pr?.number) || pr.number <= 0) {
    throw new Error("Every PR inventory entry requires a positive integer number");
  }
  const files = uniqueSortedStrings(
    (pr.files ?? []).map((file) => (typeof file === "string" ? file : file?.path)),
  );
  const filesTotal = Number.isSafeInteger(pr.filesTotal) ? pr.filesTotal : files.length;
  return {
    number: pr.number,
    headRefName: String(pr.headRefName ?? ""),
    baseRefName: String(pr.baseRefName ?? ""),
    isCrossRepository: Boolean(pr.isCrossRepository),
    isDraft: Boolean(pr.isDraft),
    mergeable: String(pr.mergeable ?? "UNKNOWN"),
    mergeStateStatus: String(pr.mergeStateStatus ?? "UNKNOWN"),
    labels: labelNames(pr.labels),
    files,
    filesTotal,
  };
}

function desiredFactLabels(pr, relationships) {
  const desired = new Set();
  if (pr.mergeable === "CONFLICTING") desired.add("lopu: conflicting");
  if (pr.mergeStateStatus === "BEHIND") desired.add("lopu: out-of-date");
  if (
    pr.mergeable === "MERGEABLE" &&
    pr.mergeStateStatus !== "BEHIND" &&
    pr.mergeStateStatus !== "UNKNOWN"
  ) {
    desired.add("lopu: mergeable");
  }
  if (pr.mergeable === "UNKNOWN" || pr.mergeStateStatus === "UNKNOWN") {
    desired.add("lopu: unknown state");
  }
  if (relationships.parents.length || relationships.children.length) {
    desired.add("lopu: part of stack");
  }
  if (relationships.targetMissing) desired.add("lopu: target PR not open");
  if (relationships.overlapPrNumbers.length) desired.add("lopu: overlapping files");
  if (pr.isCrossRepository) desired.add("lopu: fork");
  if (pr.isDraft) desired.add("lopu: draft");
  return FACT_LABEL_ORDER.filter((name) => desired.has(name));
}

export function classifyInventory(rawInventory, { defaultRef = "main" } = {}) {
  if (!Array.isArray(rawInventory)) throw new Error("PR inventory must be an array");
  const prs = rawInventory.map(normalizePr);
  const rootBranches = new Set(ROOT_BRANCHES);
  if (defaultRef) rootBranches.add(defaultRef);

  const overlapNumbers = new Map(prs.map(({ number }) => [number, new Set()]));
  const overlapFiles = new Map(prs.map(({ number }) => [number, new Set()]));
  let overlapPairs = 0;
  for (let leftIndex = 0; leftIndex < prs.length; leftIndex += 1) {
    const left = prs[leftIndex];
    const leftFiles = new Set(left.files);
    if (!leftFiles.size) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < prs.length; rightIndex += 1) {
      const right = prs[rightIndex];
      const shared = right.files.filter((path) => leftFiles.has(path));
      if (!shared.length) continue;
      overlapPairs += 1;
      overlapNumbers.get(left.number).add(right.number);
      overlapNumbers.get(right.number).add(left.number);
      for (const path of shared) {
        overlapFiles.get(left.number).add(path);
        overlapFiles.get(right.number).add(path);
      }
    }
  }

  const classified = prs.map((pr) => {
    const targetRoot = rootBranches.has(pr.baseRefName);
    const headRoot = rootBranches.has(pr.headRefName);
    const parents = targetRoot
      ? []
      : prs
          .filter((candidate) => candidate.number !== pr.number && candidate.headRefName === pr.baseRefName)
          .map(({ number }) => number);
    const children = headRoot
      ? []
      : prs
          .filter((candidate) => candidate.number !== pr.number && candidate.baseRefName === pr.headRefName)
          .map(({ number }) => number);
    const relationships = {
      parents: uniqueSortedNumbers(parents),
      children: uniqueSortedNumbers(children),
      targetRoot,
      targetMissing: !targetRoot && parents.length === 0,
      overlapPrNumbers: uniqueSortedNumbers([...overlapNumbers.get(pr.number)]),
      sharedFileCount: overlapFiles.get(pr.number).size,
    };
    return {
      number: pr.number,
      ...relationships,
      desiredFactLabels: desiredFactLabels(pr, relationships),
    };
  });

  const relationByNumber = new Map(classified.map((pr) => [pr.number, pr]));
  const stats = {
    open: prs.length,
    conflicting: prs.filter(({ mergeable }) => mergeable === "CONFLICTING").length,
    outdated: prs.filter(({ mergeStateStatus }) => mergeStateStatus === "BEHIND").length,
    mergeable: prs.filter(
      ({ mergeable, mergeStateStatus }) =>
        mergeable === "MERGEABLE" && mergeStateStatus !== "BEHIND" && mergeStateStatus !== "UNKNOWN",
    ).length,
    unknown: prs.filter(
      ({ mergeable, mergeStateStatus }) => mergeable === "UNKNOWN" || mergeStateStatus === "UNKNOWN",
    ).length,
    stackMembers: classified.filter(({ parents, children }) => parents.length || children.length).length,
    targetPrNotOpen: classified.filter(({ targetMissing }) => targetMissing).length,
    overlappingPrs: classified.filter(({ overlapPrNumbers }) => overlapPrNumbers.length).length,
    overlapPairs,
    drafts: prs.filter(({ isDraft }) => isDraft).length,
    forks: prs.filter(({ isCrossRepository }) => isCrossRepository).length,
    filesCapped: prs.filter(({ files, filesTotal }) => filesTotal > files.length).length,
  };

  return {
    defaultRef,
    stats,
    prs: prs.map((pr) => ({
      ...pr,
      ...relationByNumber.get(pr.number),
    })),
  };
}

export function labelDelta({ current = [], managed = [], desired = [] } = {}) {
  const currentNames = uniqueSortedStrings(current);
  const managedNames = new Set(uniqueSortedStrings(managed));
  const desiredNames = uniqueSortedStrings(desired);
  const currentSet = new Set(currentNames);
  const desiredSet = new Set(desiredNames);
  return {
    add: desiredNames.filter((name) => !currentSet.has(name)),
    remove: currentNames.filter((name) => managedNames.has(name) && !desiredSet.has(name)),
  };
}

export function summarizeBatch(prs, jobs) {
  if (!Array.isArray(prs) || !Array.isArray(jobs)) {
    throw new Error("Batch summary requires PR and job arrays");
  }
  const summary = { total: prs.length, resolving: 0, queued: 0, done: 0 };
  for (const pr of prs) {
    if (!Number.isSafeInteger(pr?.number) || pr.number <= 0) {
      throw new Error("Batch PR entries require a positive integer number");
    }
    const name = `Resolve PR #${pr.number}`;
    const job = jobs.filter((candidate) => candidate?.name === name).at(-1);
    if (job?.status === "in_progress") summary.resolving += 1;
    else if (job?.status === "completed") summary.done += 1;
    else summary.queued += 1;
  }
  return summary;
}

function dateParts(epochSeconds, timeZone) {
  const date = new Date(epochSeconds * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid epoch timestamp");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
}

function zoneName(epochSeconds, timeZone, style) {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: style,
  })
    .formatToParts(new Date(epochSeconds * 1000))
    .find(({ type }) => type === "timeZoneName")?.value;
  return part ?? "";
}

export function formatZonedTimestamp(epochSeconds, timeZone) {
  const parts = dateParts(epochSeconds, timeZone);
  const rawOffset = zoneName(epochSeconds, timeZone, "longOffset");
  const offset = rawOffset === "GMT" ? "UTC+00:00" : rawOffset.replace(/^GMT/u, "UTC");
  let abbreviation = zoneName(epochSeconds, timeZone, "short");
  // Small-ICU Node builds sometimes return GMT+10/GMT+11 instead of the
  // familiar Australian abbreviations. The offset remains sourced from the
  // IANA zone; this only makes its human label explicit.
  if (timeZone === "Australia/Melbourne") {
    if (offset === "UTC+10:00") abbreviation = "AEST";
    if (offset === "UTC+11:00") abbreviation = "AEDT";
  }
  if (timeZone === "America/Los_Angeles") {
    if (offset === "UTC-08:00") abbreviation = "PST";
    if (offset === "UTC-07:00") abbreviation = "PDT";
  }
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${abbreviation} (${offset})`;
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function branchCode(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

function prLinks(numbers, repo, limit = 12) {
  const safeRepo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo ?? "") ? repo : "";
  const allNumbers = uniqueSortedNumbers(numbers);
  const visible = allNumbers
    .slice(0, limit)
    .map((number) => (safeRepo ? `[#${number}](https://github.com/${safeRepo}/pull/${number})` : `#${number}`))
    .join(", ");
  const remainder = allNumbers.length - Math.min(allNumbers.length, limit);
  return remainder > 0 ? `${visible}, +${remainder} more` : visible;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function renderContext(context) {
  const nowEpoch = Number(context?.nowEpoch);
  const etaMinutes = Number(context?.etaMinutes);
  const stats = context?.stats ?? {};
  const batch = context?.batch ?? {};
  const relationships = context?.relationships ?? {};
  const repo = String(context?.repo ?? "");
  const base = String(context?.base ?? "");
  const nowRow = [
    "Updated",
    formatZonedTimestamp(nowEpoch, "UTC"),
    formatZonedTimestamp(nowEpoch, "America/Los_Angeles"),
    formatZonedTimestamp(nowEpoch, "Australia/Melbourne"),
  ];
  const timeRows = [nowRow];
  if (Number.isSafeInteger(etaMinutes) && etaMinutes > 0) {
    const etaEpoch = nowEpoch + etaMinutes * 60;
    timeRows.push([
      "Estimated finish",
      formatZonedTimestamp(etaEpoch, "UTC"),
      formatZonedTimestamp(etaEpoch, "America/Los_Angeles"),
      formatZonedTimestamp(etaEpoch, "Australia/Melbourne"),
    ]);
  }

  const lines = [
    "### Time conversion (UTC source)",
    "| Moment | UTC | Los Angeles | Melbourne |",
    "| --- | --- | --- | --- |",
    ...timeRows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
    "",
    "_Los Angeles and Melbourne use their real IANA time zones, so PDT/PST and AEST/AEDT offsets change automatically._",
    "",
    "### Lopu queue and PR pulse",
    "| Scope | Metric | Count |",
    "| --- | --- | ---: |",
    `| Repository | Open PRs | ${count(stats.open)} |`,
    `| Repository | Conflicting | ${count(stats.conflicting)} |`,
    `| Repository | Out-of-date with target | ${count(stats.outdated)} |`,
    `| Repository | GitHub state unknown | ${count(stats.unknown)} |`,
    `| Repository | Part of an open stack | ${count(stats.stackMembers)} |`,
    `| Repository | Touch files changed by another open PR | ${count(stats.overlappingPrs)} |`,
    `| Repository | Target a non-root branch without an open parent PR | ${count(stats.targetPrNotOpen)} |`,
    `| This resolver batch | Admitted snapshots | ${count(batch.total)} |`,
    `| This resolver batch | Currently resolving | ${count(batch.resolving)} |`,
    `| This resolver batch | Waiting | ${count(batch.queued)} |`,
    `| This resolver batch | Finished | ${count(batch.done)} |`,
    "",
    "### Related PR context",
  ];

  const parents = uniqueSortedNumbers(relationships.parents);
  const children = uniqueSortedNumbers(relationships.children);
  const overlapPrNumbers = uniqueSortedNumbers(relationships.overlapPrNumbers);
  const stackParts = [];
  if (parents.length) stackParts.push(`parent ${prLinks(parents, repo)}`);
  if (children.length) stackParts.push(`children ${prLinks(children, repo)}`);
  lines.push(
    stackParts.length
      ? `- **Stack:** ${stackParts.join("; ")}.`
      : "- **Stack:** No open parent or child PR currently links to this branch.",
  );
  if (relationships.targetRoot) {
    lines.push(`- **Target:** ${branchCode(base)} is a repository root/integration branch.`);
  } else if (parents.length) {
    lines.push(`- **Target:** ${branchCode(base)} is represented by open ${parents.length === 1 ? "PR" : "PRs"} ${prLinks(parents, repo)}.`);
  } else {
    lines.push(`- **Target:** ${branchCode(base)} does not currently have an open parent PR.`);
  }
  if (overlapPrNumbers.length) {
    const sharedFileCount = count(relationships.sharedFileCount);
    lines.push(
      `- **Changed-file overlap:** ${sharedFileCount} changed ${sharedFileCount === 1 ? "file is" : "files are"} also touched by ${prLinks(overlapPrNumbers, repo)}.`,
    );
  } else {
    lines.push("- **Changed-file overlap:** No changed paths overlap another open PR in this snapshot.");
  }
  lines.push("", `_Exact branch pair: ${branchCode(base)} → ${branchCode(context?.head ?? "")}._`);
  return `${lines.join("\n")}\n`;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let source = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      source += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(source || "null"));
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on("error", reject);
  });
}

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

async function main() {
  const command = process.argv[2] ?? "";
  if (command === "labels") {
    const scope = argument("--scope", "all");
    const labels = scope === "all" ? LABEL_DEFINITIONS : LABEL_DEFINITIONS.filter((label) => label.scope === scope);
    process.stdout.write(`${JSON.stringify(labels)}\n`);
    return;
  }
  if (command === "classify") {
    const inventory = await readStdin();
    const defaultRef = argument("--default-ref", "main");
    process.stdout.write(`${JSON.stringify(classifyInventory(inventory, { defaultRef }))}\n`);
    return;
  }
  if (command === "label-delta") {
    const input = await readStdin();
    process.stdout.write(`${JSON.stringify(labelDelta(input))}\n`);
    return;
  }
  if (command === "batch-counts") {
    const input = await readStdin();
    process.stdout.write(`${JSON.stringify(summarizeBatch(input?.prs, input?.jobs))}\n`);
    return;
  }
  if (command === "render-context") {
    const context = await readStdin();
    process.stdout.write(renderContext(context));
    return;
  }
  throw new Error(`Unknown command: ${command || "<empty>"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
