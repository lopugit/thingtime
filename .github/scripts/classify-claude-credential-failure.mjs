#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CAPACITY_PATTERNS = [
  /\busage limit\b/iu,
  /\b(?:weekly|session|plan|five[- ]hour|5[- ]hour) limit\b/iu,
  /\blimit (?:has been )?reached\b/iu,
  /\breached (?:your|the|a) .*\blimit\b/iu,
  /\b(?:resets?|resetting) (?:at|in|on)\b/iu,
  /\brate[_ -]?limit(?:ed|ing)?\b/iu,
  /\btoo many requests\b/iu,
  /\b(?:status|http|error)[^\n]{0,20}\b429\b/iu,
  /\bquota (?:has been )?(?:exceeded|exhausted)\b/iu,
  /\binsufficient (?:credit|credits|balance)\b/iu,
  /\b(?:credit|credits|balance)[^\n]{0,40}\b(?:exhausted|depleted|empty)\b/iu,
  /\b(?:spend|spending) limit\b/iu,
  /\bpayment required\b/iu,
];

const CREDENTIAL_PATTERNS = [
  /\bauthentication[_ -]?error\b/iu,
  /\bfailed to authenticate\b/iu,
  /\binvalid (?:anthropic )?(?:api key|oauth token|access token|credential)\b/iu,
  /\b(?:oauth|access) token[^\n]{0,40}\b(?:expired|invalid|revoked)\b/iu,
  /\boauth session[^\n]{0,80}\b(?:expired|invalid|revoked|could not be refreshed)\b/iu,
  /\b(?:unauthorized|not authorized)\b/iu,
  /\b(?:status|http|error)[^\n]{0,20}\b401\b/iu,
];

function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
  return output;
}

export function classifyClaudeCredentialFailure(value) {
  const text = collectStrings(value).join("\n");
  if (CAPACITY_PATTERNS.some((pattern) => pattern.test(text))) {
    return { retryable: true, reason: "account-capacity" };
  }
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return { retryable: true, reason: "credential-rejected" };
  }
  return { retryable: false, reason: "non-credential-failure" };
}

function selfTest() {
  for (const sample of [
    { type: "result", subtype: "error_during_execution", error: "Weekly limit reached · resets Tue 4:00 PM" },
    [{ type: "assistant", message: { content: [{ type: "text", text: "rate_limit_error: too many requests (HTTP 429)" }] } }],
    { error: { message: "Your credit balance is exhausted" } },
  ]) {
    assert.deepEqual(classifyClaudeCredentialFailure(sample), {
      retryable: true,
      reason: "account-capacity",
    });
  }
  for (const sample of [
    { type: "result", is_error: true, error: "authentication_error: invalid OAuth token" },
    { type: "result", is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed" },
    { status: 401, message: "Unauthorized" },
  ]) {
    assert.deepEqual(classifyClaudeCredentialFailure(sample), {
      retryable: true,
      reason: "credential-rejected",
    });
  }
  for (const sample of [
    { type: "result", subtype: "error_max_turns", error: "Reached max turns 500" },
    { type: "result", subtype: "error_during_execution", error: "Tests failed" },
    { type: "result", subtype: "success", result: "Resolved conflict" },
  ]) {
    assert.deepEqual(classifyClaudeCredentialFailure(sample), {
      retryable: false,
      reason: "non-credential-failure",
    });
  }
  console.log("Claude credential failure classifier: self-test OK");
}

function main() {
  const argument = process.argv[2];
  if (argument === "--self-test") {
    selfTest();
    return;
  }
  if (!argument) {
    console.error("usage: classify-claude-credential-failure.mjs <execution-json>");
    process.exitCode = 64;
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(argument, "utf8"));
  } catch {
    process.stdout.write("retryable=false\nreason=missing-or-invalid-output\n");
    return;
  }
  const result = classifyClaudeCredentialFailure(parsed);
  process.stdout.write(`retryable=${result.retryable}\nreason=${result.reason}\n`);
}

main();
