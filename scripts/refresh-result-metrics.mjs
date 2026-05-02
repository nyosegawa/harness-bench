#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const runsRoot = resolve(process.argv[2] ?? "benchmark/runs");
const resultPaths = readdirSync(runsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(runsRoot, entry.name, "result.json"))
  .filter((path) => existsSync(path));

let updated = 0;
for (const resultPath of resultPaths) {
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (result.mode !== "agent") continue;
  const runDir = resolve(resultPath, "..");
  const before = JSON.stringify(result.metrics?.usage ?? {});
  refresh(result, runDir);
  const after = JSON.stringify(result.metrics?.usage ?? {});
  if (before !== after) {
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    updated += 1;
    console.log(`updated ${resultPath}`);
  }
}

console.error(`updated ${updated} results`);

function refresh(result, runDir) {
  result.metrics = result.metrics ?? {};
  result.metrics.harness = result.metrics.harness ?? {};
  const previous = result.metrics.usage ?? {};

  if (result.harness === "codex") {
    const events = readJsonl(resolve(runDir, "harness.events.jsonl"));
    if (events.length === 0) return;
    result.metrics.harness.model = result.metrics.harness.model ?? result.model ?? null;
    result.metrics.usage = normalizeCodexUsage(events, previous);
    return;
  }

  if (result.harness === "claude") {
    const raw = readJsonFile(resolve(runDir, "harness.result.json"));
    if (!raw) return;
    result.metrics.harness.model = result.model ?? result.metrics.harness.model ?? dominantClaudeModel(raw.modelUsage) ?? null;
    result.metrics.usage = normalizeClaudeUsage(raw, previous);
    return;
  }

  if (result.harness === "cursor") {
    const events = readJsonl(resolve(runDir, "harness.events.jsonl"));
    if (events.length === 0) return;
    const normalized = normalizeCursorUsage(events, previous);
    result.metrics.harness.model = result.metrics.harness.model ?? normalized.model ?? null;
    result.metrics.usage = normalized.usage;
  }
}

function normalizeCodexUsage(events, previous) {
  const turnCompleted = events.filter((event) => event.type === "turn.completed");
  const rawUsage = turnCompleted.at(-1)?.usage ?? previous.raw_usage ?? {};
  const completedItems = events.filter((event) => event.type === "item.completed");
  const commandCalls = completedItems.filter((event) => event.item?.type === "command_execution").length;
  const fileChanges = completedItems.filter((event) => event.item?.type === "file_change").length;
  return normalizeDerivedUsage({
    ...previous,
    conversation_turns: turnCompleted.length,
    turns: turnCompleted.length,
    assistant_messages: completedItems.filter((event) => event.item?.type === "agent_message").length,
    command_calls: commandCalls,
    file_changes: fileChanges,
    tool_calls: commandCalls + fileChanges,
    input_tokens: rawUsage.input_tokens ?? previous.input_tokens ?? null,
    output_tokens: rawUsage.output_tokens ?? previous.output_tokens ?? null,
    reasoning_tokens: rawUsage.reasoning_output_tokens ?? previous.reasoning_tokens ?? null,
    cache_read_tokens: rawUsage.cached_input_tokens ?? previous.cache_read_tokens ?? null,
    cache_write_tokens: previous.cache_write_tokens ?? null,
    raw_usage: rawUsage,
  }, { inputIncludesCache: true });
}

function normalizeClaudeUsage(raw, previous) {
  const rawUsage = raw.usage ?? {};
  return normalizeDerivedUsage({
    ...previous,
    conversation_turns: raw.num_turns ?? previous.conversation_turns ?? previous.turns ?? null,
    turns: raw.num_turns ?? previous.turns ?? null,
    assistant_messages: raw.num_turns ?? previous.assistant_messages ?? null,
    input_tokens: rawUsage.input_tokens ?? previous.input_tokens ?? null,
    output_tokens: rawUsage.output_tokens ?? previous.output_tokens ?? null,
    cache_read_tokens: rawUsage.cache_read_input_tokens ?? previous.cache_read_tokens ?? null,
    cache_write_tokens: rawUsage.cache_creation_input_tokens ?? previous.cache_write_tokens ?? null,
    cost_usd: raw.total_cost_usd ?? previous.cost_usd ?? null,
    cost_source: raw.total_cost_usd != null ? "reported" : previous.cost_source ?? "unavailable",
    raw_usage: {
      usage: raw.usage ?? null,
      modelUsage: raw.modelUsage ?? null,
    },
  });
}

function normalizeCursorUsage(events, previous) {
  const init = events.find((event) => event.type === "system" && event.subtype === "init");
  const result = events.findLast((event) => event.type === "result") ?? {};
  const rawUsage = result.usage ?? {};
  const assistantMessages = events.filter((event) => event.type === "assistant").length;
  return {
    model: init?.model ?? null,
    usage: normalizeDerivedUsage({
      ...previous,
      conversation_turns: assistantMessages,
      turns: assistantMessages,
      assistant_messages: assistantMessages,
      tool_calls: events.filter((event) => event.type === "tool_call" && event.subtype === "completed").length,
      input_tokens: rawUsage.inputTokens ?? previous.input_tokens ?? null,
      output_tokens: rawUsage.outputTokens ?? previous.output_tokens ?? null,
      cache_read_tokens: rawUsage.cacheReadTokens ?? previous.cache_read_tokens ?? null,
      cache_write_tokens: rawUsage.cacheWriteTokens ?? previous.cache_write_tokens ?? null,
      raw_usage: rawUsage,
    }),
  };
}

function normalizeDerivedUsage(usage, options = {}) {
  const input = numericOrNull(usage.input_tokens);
  const cacheRead = numericOrNull(usage.cache_read_tokens);
  const cacheWrite = numericOrNull(usage.cache_write_tokens);
  const output = numericOrNull(usage.output_tokens);
  const freshInput = numericOrNull(usage.fresh_input_tokens) ??
    (options.inputIncludesCache ? subtractNullable(input, cacheRead) : input);
  const effectiveInput = numericOrNull(usage.effective_input_tokens) ??
    (options.inputIncludesCache ? input : sumNullable(freshInput, cacheRead, cacheWrite));
  return {
    ...usage,
    fresh_input_tokens: freshInput,
    effective_input_tokens: effectiveInput,
    fresh_total_tokens: sumNullable(freshInput, output),
    effective_total_tokens: sumNullable(effectiveInput, output),
    total_tokens: sumNullable(effectiveInput, output),
    cost_source: usage.cost_source ?? "unavailable",
  };
}

function dominantClaudeModel(modelUsage) {
  const entries = Object.entries(modelUsage ?? {});
  if (entries.length === 0) return null;
  return entries.sort((a, b) => (b[1]?.costUSD ?? 0) - (a[1]?.costUSD ?? 0))[0][0];
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function numericOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumNullable(...values) {
  const present = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0);
}

function subtractNullable(left, right) {
  if (typeof left !== "number") return null;
  if (typeof right !== "number") return left;
  return Math.max(0, left - right);
}
