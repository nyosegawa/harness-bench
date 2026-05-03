#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const casePath = resolve(required(args.case, "--case <path> is required"));
const mode = args.mode ?? "verify-current";
const harness = args.harness ?? null;
const model = args.model ?? null;
const effort = args.effort ?? null;
const agentTimeoutMs = Number(args.agentTimeoutMs ?? 900000);
const rateCardPath = args.rateCard ? resolve(args.rateCard) : null;
const rateCard = rateCardPath ? loadRateCard(rateCardPath) : null;
const workRoot = resolve(args.workRoot ?? "benchmark/workspaces");
const runsRoot = resolve(args.runsRoot ?? "benchmark/runs");
const repoOverride = args.repoDir ? resolve(args.repoDir) : null;
const conditionId = args.conditionId ?? defaultConditionId({ harness, model, effort });
const matrixId = args.matrixId ?? null;
const attempt = Number(args.attempt ?? 1);

if (!["verify-base", "verify-fixed", "verify-current", "agent"].includes(mode)) {
  fatal(`unsupported --mode ${mode}`);
}
if (mode === "agent" && !harness) {
  fatal("--harness <codex|claude|cursor> is required for --mode agent");
}

const caseData = parseSimpleYaml(readFileSync(casePath, "utf8"));
const caseId = required(caseData.id, "case id is required");
const repo = required(caseData.repo, "case repo is required");
const repoUrl = required(caseData.repo_url, "case repo_url is required");

const repoSlug = repo.replace("/", "__");
const repoDir = repoOverride ?? (mode === "agent" ? null : resolve(workRoot, repoSlug));
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${caseId}-${mode}`;
const runDir = resolve(runsRoot, runId);
mkdirSync(runDir, { recursive: true });

const startedAt = new Date();
const result = {
  case_id: caseId,
  case_path: casePath,
  repo,
  repo_url: repoUrl,
  mode,
  repo_dir: repoDir,
  harness,
  model,
  effort,
  condition_id: conditionId,
  matrix_id: matrixId,
  attempt,
  run_id: runId,
  run_dir: runDir,
  started_at: startedAt.toISOString(),
  checkout_commit: null,
  case_metadata: caseMetadata(caseData),
  test_strategy: caseData.test_strategy ?? null,
  metrics: {
    wall_time_ms: null,
    harness: null,
    tests: {
      total_duration_ms: 0,
      core_duration_ms: 0,
      regression_duration_ms: 0,
      oracle_duration_ms: 0,
    },
    usage: emptyUsageMetrics(),
  },
  steps: [],
  success: false,
};

try {
  let activeRepoDir = repoDir;
  if (mode === "agent") {
    activeRepoDir = repoOverride ?? resolve(runDir, "workspace");
    result.repo_dir = activeRepoDir;
    ensureRepo(repoUrl, activeRepoDir);
    checkout(activeRepoDir, required(caseData.base_commit, "base_commit is required"));
    result.checkout_commit = caseData.base_commit;
    const agentResult = runAgent({
      harness,
      model,
      effort,
      conditionId,
      matrixId,
      attempt,
      caseData,
      repoDir: activeRepoDir,
      runDir,
      timeoutMs: agentTimeoutMs,
    });
    result.agent_result = agentResult;
    result.metrics.harness = agentResult.metrics;
    result.metrics.usage = agentResult.metrics.usage;
    applyCostEstimate(result.metrics.usage, agentResult.metrics.model ?? model, rateCard);
    saveDiff(activeRepoDir, runDir, result);
  } else {
    ensureRepo(repoUrl, activeRepoDir);

    if (mode === "verify-base") {
      checkout(activeRepoDir, required(caseData.base_commit, "base_commit is required"));
      result.checkout_commit = caseData.base_commit;
    } else if (mode === "verify-fixed") {
      checkout(activeRepoDir, required(caseData.fixed_commit, "fixed_commit is required"));
      result.checkout_commit = caseData.fixed_commit;
    } else {
      result.checkout_commit = git(activeRepoDir, ["rev-parse", "HEAD"]).stdout.trim();
    }
  }

  const strategyResult = runTestStrategy(caseData, activeRepoDir, runDir);
  result.test_result = strategyResult;
  result.metrics.tests = strategyResult.metrics;
  result.success = strategyResult.success;
} catch (error) {
  result.error = {
    message: error.message,
    stack: error.stack,
  };
  result.success = false;
} finally {
  result.finished_at = new Date().toISOString();
  result.duration_ms = new Date(result.finished_at).getTime() - startedAt.getTime();
  result.metrics.wall_time_ms = result.duration_ms;
  applyInvalidRunClassification(result);
  const resultPath = resolve(runDir, "result.json");
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ success: result.success, runDir, resultPath }, null, 2));
  process.exit(result.success ? 0 : 1);
}

function runTestStrategy(caseData, repoDir, runDir) {
  const strategy = caseData.test_strategy ?? {
    core_tests: caseData.hidden_tests ?? [],
    oracle_suites: [],
    regression_tests: [],
    success_rule: "core_tests_pass",
  };

  const core = runCommands("core", strategy.core_tests ?? [], repoDir, runDir);
  const regressions = runCommands("regression", strategy.regression_tests ?? [], repoDir, runDir);
  const oracleSuites = runOracleSuites(strategy.oracle_suites ?? [], repoDir, runDir);

  const corePass = core.every((test) => test.exit_code === 0);
  const regressionPass = regressions.every((test) => test.exit_code === 0);
  const hasOracleSuites = oracleSuites.length > 0;
  const oraclePass = !hasOracleSuites || oracleSuites.some((suite) => suite.success);

  let success;
  switch (strategy.success_rule) {
    case "core_tests_pass":
      success = corePass;
      break;
    case "core_and_regression":
      success = corePass && regressionPass;
      break;
    case "core_and_regression_and_one_oracle":
      success = corePass && regressionPass && oraclePass;
      break;
    default:
      success = corePass && regressionPass && oraclePass;
      break;
  }

  return {
    success,
    success_rule: strategy.success_rule ?? "default",
    core_pass: corePass,
    regression_pass: regressionPass,
    oracle_pass: oraclePass,
    core,
    regressions,
    oracle_suites: oracleSuites,
    metrics: summarizeTestMetrics(core, regressions, oracleSuites),
  };
}

function runCommands(group, commands, repoDir, runDir) {
  return commands.map((command, index) => runTestCommand(group, index, command, repoDir, runDir));
}

function runOracleSuites(suites, repoDir, runDir) {
  return suites.map((suite, index) => {
    const id = suite.id ?? `oracle-${index}`;
    const commands = suite.command ? [suite.command] : suite.commands ?? [];
    const tests = commands.map((command, commandIndex) =>
      runTestCommand(`oracle-${id}`, commandIndex, command, repoDir, runDir),
    );
    return {
      id,
      success: tests.length > 0 && tests.every((test) => test.exit_code === 0),
      tests,
    };
  });
}

function runTestCommand(group, index, command, repoDir, runDir) {
  const normalized = String(command);
  const safeGroup = group.replace(/[^A-Za-z0-9_.-]/g, "_");
  const stdoutPath = resolve(runDir, `${safeGroup}-${index}.stdout.log`);
  const stderrPath = resolve(runDir, `${safeGroup}-${index}.stderr.log`);
  const started = new Date();
  const startedMs = Date.now();
  const result = spawnSync("bash", ["-lc", `${shellQuote(normalized)} ${shellQuote(repoDir)}`], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  writeFileSync(stdoutPath, result.stdout ?? "");
  writeFileSync(stderrPath, result.stderr ?? "");

  return {
    group,
    index,
    command: normalized,
    exit_code: result.status,
    signal: result.signal,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    started_at: started.toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedMs,
  };
}

function summarizeTestMetrics(core, regressions, oracleSuites) {
  const oracleTests = oracleSuites.flatMap((suite) => suite.tests);
  const coreDuration = sumDurations(core);
  const regressionDuration = sumDurations(regressions);
  const oracleDuration = sumDurations(oracleTests);
  return {
    total_duration_ms: coreDuration + regressionDuration + oracleDuration,
    core_duration_ms: coreDuration,
    regression_duration_ms: regressionDuration,
    oracle_duration_ms: oracleDuration,
  };
}

function sumDurations(tests) {
  return tests.reduce((sum, test) => sum + (test.duration_ms ?? 0), 0);
}

function emptyUsageMetrics() {
  return {
    conversation_turns: null,
    turns: null,
    assistant_messages: null,
    tool_calls: null,
    command_calls: null,
    file_changes: null,
    fresh_input_tokens: null,
    input_tokens: null,
    effective_input_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    fresh_total_tokens: null,
    effective_total_tokens: null,
    total_tokens: null,
    cost_usd: null,
    cost_source: null,
    raw_usage: null,
  };
}

function runAgent({ harness, model, effort, conditionId, matrixId, attempt, caseData, repoDir, runDir, timeoutMs }) {
  const prompt = buildPrompt(caseData);
  const promptPath = resolve(runDir, "prompt.txt");
  writeFileSync(promptPath, prompt);
  writePromptBundle({ caseData, harness, model, effort, conditionId, matrixId, attempt, prompt, runDir });

  if (harness === "codex") {
    return runCodexAgent({ model, effort, prompt, repoDir, runDir, timeoutMs });
  }
  if (harness === "claude") {
    return runClaudeAgent({ model, effort, prompt, repoDir, runDir, timeoutMs });
  }
  if (harness === "cursor") {
    return runCursorAgent({ model, prompt, repoDir, runDir, timeoutMs });
  }
  fatal(`unsupported harness ${harness}`);
}

function writePromptBundle({ caseData, harness, model, effort, conditionId, matrixId, attempt, prompt, runDir }) {
  const bundle = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    matrix_id: matrixId,
    condition_id: conditionId,
    attempt,
    harness,
    model,
    effort,
    case: {
      id: caseData.id ?? null,
      repo: caseData.repo ?? null,
      repo_url: caseData.repo_url ?? null,
      license: caseData.license ?? null,
      size_bucket: caseData.size_bucket ?? null,
      language_tags: caseData.language_tags ?? [],
      difficulty: caseData.difficulty ?? null,
      instruction: caseData.instruction ?? null,
      base_commit: caseData.base_commit ?? null,
      fixed_commit: caseData.fixed_commit ?? null,
      pr_number: caseData.pr_number ?? null,
      pr_url: caseData.pr_url ?? null,
      pr_title: caseData.pr_title ?? null,
      merged_at: caseData.merged_at ?? null,
    },
    prompt,
    hidden_tests_visible_to_agent: false,
    prompt_policy: {
      hide_original_pr: true,
      hide_fixed_commit: true,
      hide_hidden_tests: true,
      disable_memory_for_baseline: true,
    },
  };
  writeFileSync(resolve(runDir, "prompt-bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);
}

function buildPrompt(caseData) {
  return [
    "You are debugging this repository.",
    "",
    "Rules:",
    "- Work only inside the current repository.",
    "- Do not inspect benchmark metadata, hidden tests, PRs, patches, or external web pages.",
    "- Reproduce the described behavior if useful, implement a minimal fix, and run relevant public tests.",
    "- Do not add unrelated refactors.",
    "",
    "Issue:",
    caseData.instruction,
    "",
    "Final response:",
    "- Briefly summarize the root cause and fix.",
    "- Mention tests you ran.",
  ].join("\n");
}

function caseMetadata(caseData) {
  return {
    difficulty: caseData.difficulty ?? null,
    size_bucket: caseData.size_bucket ?? null,
    language_tags: caseData.language_tags ?? [],
    license: caseData.license ?? null,
    stars_at_selection: caseData.stars_at_selection ?? null,
    pr_number: caseData.pr_number ?? null,
    pr_url: caseData.pr_url ?? null,
    pr_title: caseData.pr_title ?? null,
    merged_at: caseData.merged_at ?? null,
    base_commit: caseData.base_commit ?? null,
    fixed_commit: caseData.fixed_commit ?? null,
  };
}

function runCodexAgent({ model, effort, prompt, repoDir, runDir, timeoutMs }) {
  const stdoutPath = resolve(runDir, "harness.events.jsonl");
  const stderrPath = resolve(runDir, "harness.stderr.log");
  const command = [
    "codex",
    "exec",
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--disable",
    "memories",
    "--disable",
    "plugins",
    "--disable",
    "apps",
    "--disable",
    "browser_use",
    "--disable",
    "computer_use",
    "--sandbox",
    "workspace-write",
    "-m",
    model ?? "gpt-5.5",
    "-c",
    `model_reasoning_effort="${effort ?? "medium"}"`,
    "-C",
    repoDir,
    prompt,
  ];
  const execution = runHarnessProcess(command, repoDir, stdoutPath, stderrPath, {}, timeoutMs);
  const events = readJsonl(stdoutPath);
  return {
    harness: "codex",
    command,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    exit_code: execution.status,
    signal: execution.signal,
    error: execution.error,
    timed_out: execution.timed_out,
    duration_ms: execution.duration_ms,
    metrics: normalizeCodexMetrics(events, execution, model ?? "gpt-5.5"),
  };
}

function runClaudeAgent({ model, effort, prompt, repoDir, runDir, timeoutMs }) {
  const stdoutPath = resolve(runDir, "harness.result.json");
  const stderrPath = resolve(runDir, "harness.stderr.log");
  const settings = JSON.stringify({
    claudeMdExcludes: [
      resolve(repoDir, "CLAUDE.md"),
      resolve(repoDir, ".claude/rules/**"),
    ],
  });
  const command = [
    "claude",
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--model",
    model ?? "claude-opus-4-7",
    "--effort",
    effort ?? "medium",
    "--permission-mode",
    "bypassPermissions",
    "--setting-sources",
    "project",
    "--settings",
    settings,
    prompt,
  ];
  const execution = runHarnessProcess(command, repoDir, stdoutPath, stderrPath, {
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  }, timeoutMs);
  const raw = readJsonFile(stdoutPath);
  return {
    harness: "claude",
    command,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    exit_code: execution.status,
    signal: execution.signal,
    error: execution.error,
    timed_out: execution.timed_out,
    duration_ms: execution.duration_ms,
    metrics: normalizeClaudeMetrics(raw, execution, model ?? "claude-opus-4-7"),
  };
}

function runCursorAgent({ model, prompt, repoDir, runDir, timeoutMs }) {
  const stdoutPath = resolve(runDir, "harness.events.jsonl");
  const stderrPath = resolve(runDir, "harness.stderr.log");
  const command = [
    "agent",
    "-p",
    "--output-format",
    "stream-json",
    "--trust",
    "--workspace",
    repoDir,
  ];
  if (model) {
    command.push("--model", model);
  }
  command.push(prompt);
  const execution = runHarnessProcess(command, repoDir, stdoutPath, stderrPath, {}, timeoutMs);
  const events = readJsonl(stdoutPath);
  return {
    harness: "cursor",
    command,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    exit_code: execution.status,
    signal: execution.signal,
    error: execution.error,
    timed_out: execution.timed_out,
    duration_ms: execution.duration_ms,
    metrics: normalizeCursorMetrics(events, execution),
  };
}

function runHarnessProcess(command, cwd, stdoutPath, stderrPath, extraEnv = {}, timeoutMs = 900000) {
  const startedAt = new Date();
  const startedMs = Date.now();
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
    env: { ...process.env, ...extraEnv },
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
  writeFileSync(stdoutPath, result.stdout ?? "");
  writeFileSync(stderrPath, result.stderr ?? "");
  return {
    status: result.status,
    signal: result.signal,
    error: result.error ? { message: result.error.message, code: result.error.code } : null,
    timed_out: result.error?.code === "ETIMEDOUT",
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedMs,
  };
}

function normalizeCodexMetrics(events, execution, requestedModel = null) {
  const turnCompleted = events.filter((event) => event.type === "turn.completed");
  const usage = turnCompleted.at(-1)?.usage ?? {};
  const completedItems = events.filter((event) => event.type === "item.completed");
  const assistantMessages = completedItems.filter((event) => event.item?.type === "agent_message").length;
  const commandCalls = completedItems.filter((event) => event.item?.type === "command_execution").length;
  const fileChanges = completedItems.filter((event) => event.item?.type === "file_change").length;
  const toolCalls = commandCalls + fileChanges;
  const input = usage.input_tokens ?? null;
  const output = usage.output_tokens ?? null;
  const cacheRead = usage.cached_input_tokens ?? null;
  const freshInput = subtractNullable(input, cacheRead);
  const totals = tokenTotals({ freshInput, effectiveInput: input, output });
  return {
    harness: "codex",
    model: modelFromCodexEvents(events) ?? requestedModel,
    harness_duration_ms: execution.duration_ms,
    usage: {
      ...emptyUsageMetrics(),
      conversation_turns: turnCompleted.length,
      turns: turnCompleted.length,
      assistant_messages: assistantMessages,
      tool_calls: toolCalls,
      command_calls: commandCalls,
      file_changes: fileChanges,
      fresh_input_tokens: freshInput,
      input_tokens: input,
      effective_input_tokens: input,
      output_tokens: output,
      reasoning_tokens: usage.reasoning_output_tokens ?? null,
      cache_read_tokens: cacheRead,
      cache_write_tokens: null,
      fresh_total_tokens: totals.freshTotal,
      effective_total_tokens: totals.effectiveTotal,
      total_tokens: totals.effectiveTotal,
      cost_usd: null,
      cost_source: "unavailable",
      raw_usage: usage,
    },
  };
}

function normalizeClaudeMetrics(raw, execution, requestedModel = null) {
  const usage = raw?.usage ?? {};
  const freshInput = usage.input_tokens ?? null;
  const cacheRead = usage.cache_read_input_tokens ?? null;
  const cacheWrite = usage.cache_creation_input_tokens ?? null;
  const effectiveInput = sumNullable(freshInput, cacheRead, cacheWrite);
  const output = usage.output_tokens ?? null;
  const totals = tokenTotals({ freshInput, effectiveInput, output });
  return {
    harness: "claude",
    model: requestedModel ?? dominantClaudeModel(raw?.modelUsage),
    harness_duration_ms: execution.duration_ms,
    harness_reported_duration_ms: raw?.duration_ms ?? null,
    harness_reported_api_duration_ms: raw?.duration_api_ms ?? null,
    usage: {
      ...emptyUsageMetrics(),
      conversation_turns: raw?.num_turns ?? null,
      turns: raw?.num_turns ?? null,
      assistant_messages: raw?.num_turns ?? null,
      tool_calls: null,
      command_calls: null,
      file_changes: null,
      fresh_input_tokens: freshInput,
      input_tokens: freshInput,
      effective_input_tokens: effectiveInput,
      output_tokens: output,
      reasoning_tokens: null,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      fresh_total_tokens: totals.freshTotal,
      effective_total_tokens: totals.effectiveTotal,
      total_tokens: totals.effectiveTotal,
      cost_usd: raw?.total_cost_usd ?? null,
      cost_source: raw?.total_cost_usd != null ? "reported" : "unavailable",
      raw_usage: {
        usage: raw?.usage ?? null,
        modelUsage: raw?.modelUsage ?? null,
      },
    },
  };
}

function dominantClaudeModel(modelUsage) {
  const entries = Object.entries(modelUsage ?? {});
  if (entries.length === 0) return null;
  return entries.sort((a, b) => (b[1]?.costUSD ?? 0) - (a[1]?.costUSD ?? 0))[0][0];
}

function normalizeCursorMetrics(events, execution) {
  const init = events.find((event) => event.type === "system" && event.subtype === "init");
  const result = events.findLast((event) => event.type === "result") ?? {};
  const usage = result.usage ?? {};
  const freshInput = usage.inputTokens ?? null;
  const cacheRead = usage.cacheReadTokens ?? null;
  const cacheWrite = usage.cacheWriteTokens ?? null;
  const effectiveInput = sumNullable(freshInput, cacheRead, cacheWrite);
  const output = usage.outputTokens ?? null;
  const assistantMessages = events.filter((event) => event.type === "assistant").length;
  const completedToolCalls = events.filter((event) => event.type === "tool_call" && event.subtype === "completed");
  const toolCalls = completedToolCalls.length;
  const commandCalls = completedToolCalls.filter(isCursorCommandToolCall).length;
  const fileChanges = completedToolCalls.filter(isCursorFileToolCall).length;
  const totals = tokenTotals({ freshInput, effectiveInput, output });
  return {
    harness: "cursor",
    model: init?.model ?? null,
    harness_duration_ms: execution.duration_ms,
    harness_reported_duration_ms: result.duration_ms ?? null,
    harness_reported_api_duration_ms: result.duration_api_ms ?? null,
    usage: {
      ...emptyUsageMetrics(),
      conversation_turns: assistantMessages,
      turns: assistantMessages,
      assistant_messages: assistantMessages,
      tool_calls: toolCalls,
      command_calls: commandCalls,
      file_changes: fileChanges,
      fresh_input_tokens: freshInput,
      input_tokens: freshInput,
      effective_input_tokens: effectiveInput,
      output_tokens: output,
      reasoning_tokens: null,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      fresh_total_tokens: totals.freshTotal,
      effective_total_tokens: totals.effectiveTotal,
      total_tokens: totals.effectiveTotal,
      cost_usd: null,
      cost_source: "unavailable",
      raw_usage: usage,
    },
  };
}

function isCursorCommandToolCall(event) {
  return Boolean(event.tool_call?.shellToolCall);
}

function isCursorFileToolCall(event) {
  const toolCall = event.tool_call ?? {};
  return Boolean(toolCall.editToolCall || toolCall.writeToolCall || toolCall.deleteToolCall);
}

function modelFromCodexEvents(_events) {
  return null;
}

function sumNullable(...values) {
  const present = values.filter((value) => typeof value === "number");
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0);
}

function subtractNullable(left, right) {
  if (typeof left !== "number") return null;
  if (typeof right !== "number") return left;
  return Math.max(0, left - right);
}

function tokenTotals({ freshInput, effectiveInput, output }) {
  return {
    freshTotal: sumNullable(freshInput, output),
    effectiveTotal: sumNullable(effectiveInput, output),
  };
}

function saveDiff(repoDir, runDir, result) {
  const diff = git(repoDir, ["diff", "--binary"]).stdout;
  const diffPath = resolve(runDir, "harness.diff.patch");
  writeFileSync(diffPath, diff);
  const status = git(repoDir, ["status", "--short"]).stdout;
  const statusPath = resolve(runDir, "harness.git-status.txt");
  writeFileSync(statusPath, status);
  result.diff_path = diffPath;
  result.git_status_path = statusPath;
  result.modified_files = status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3));
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
        return { type: "parse_error", raw: line };
      }
    });
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true, raw: text };
  }
}

function loadRateCard(path) {
  const raw = readFileSync(path, "utf8");
  const card = JSON.parse(raw);
  return {
    ...card,
    path,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

function applyCostEstimate(usage, modelName, card) {
  if (!usage || usage.cost_source === "reported") return;
  if (!card) {
    usage.cost_source = usage.cost_source ?? "unavailable";
    return;
  }

  const canonicalModel = card.aliases?.[modelName] ?? modelName;
  const rates = card.models?.[canonicalModel];
  usage.rate_card = rateCardMetadata(card, canonicalModel);

  if (!rates) {
    usage.cost_usd = null;
    usage.cost_source = "unavailable";
    usage.cost_estimate_error = `missing rate for model ${modelName ?? "unknown"}`;
    return;
  }

  const parts = [];
  addCostPart(parts, "input", usage.fresh_input_tokens ?? freshInputFromUsage(usage), rates.input);
  addCostPart(parts, "cached_input", usage.cache_read_tokens, rates.cached_input);
  addCostPart(parts, "output", usage.output_tokens, rates.output);
  addCostPart(parts, "reasoning_output", usage.reasoning_tokens, rates.reasoning_output);
  addCostPart(parts, "cache_write", usage.cache_write_tokens, rates.cache_write);

  usage.cost_breakdown = parts;
  const missing = parts.filter((part) => part.missing_rate && part.tokens > 0);
  if (missing.length > 0) {
    usage.cost_usd = null;
    usage.cost_source = "unavailable";
    usage.cost_estimate_error = `missing rates: ${missing.map((part) => part.kind).join(", ")}`;
    return;
  }

  usage.cost_usd = parts.reduce((sum, part) => sum + part.cost_usd, 0);
  usage.cost_source = "estimated";
  usage.cost_label = "api_equivalent_estimate";
}

function freshInputFromUsage(usage) {
  if (typeof usage.fresh_input_tokens === "number") return usage.fresh_input_tokens;
  if (typeof usage.input_tokens !== "number") return null;
  if (typeof usage.cache_read_tokens !== "number") return usage.input_tokens;
  return Math.max(0, usage.input_tokens - usage.cache_read_tokens);
}

function addCostPart(parts, kind, tokens, ratePerMillion) {
  const normalizedTokens = Number(tokens ?? 0);
  const hasRate = typeof ratePerMillion === "number";
  parts.push({
    kind,
    tokens: normalizedTokens,
    rate_per_1m_tokens: hasRate ? ratePerMillion : null,
    cost_usd: hasRate ? (normalizedTokens / 1_000_000) * ratePerMillion : 0,
    missing_rate: !hasRate,
  });
}

function rateCardMetadata(card, canonicalModel) {
  return {
    id: card.id ?? null,
    path: card.path,
    sha256: card.sha256,
    currency: card.currency ?? "USD",
    unit: card.unit ?? "per_1m_tokens",
    model: canonicalModel ?? null,
  };
}

function applyInvalidRunClassification(result) {
  const reason = invalidRunReason(result);
  if (!reason) return;
  result.invalid_run = true;
  result.invalid_reason = reason;
}

function invalidRunReason(result) {
  if (result.error?.message) {
    return `infrastructure failure: runner error: ${result.error.message}`;
  }

  const agent = result.agent_result;
  if (agent?.error?.code === "ENOENT") {
    return `infrastructure failure: missing harness command: ${agent.command?.[0] ?? "unknown"}`;
  }
  if (agent?.error?.code && agent.error.code !== "ETIMEDOUT") {
    return `infrastructure failure: harness process error ${agent.error.code}`;
  }

  const infraText = [
    agent?.stderr_path ? readText(agent.stderr_path) : "",
    ...(result.test_result?.core ?? []).flatMap((test) => [readText(test.stdout_path), readText(test.stderr_path)]),
    ...(result.test_result?.regressions ?? []).flatMap((test) => [readText(test.stdout_path), readText(test.stderr_path)]),
    ...(result.test_result?.oracle_suites ?? []).flatMap((suite) =>
      suite.tests.flatMap((test) => [readText(test.stdout_path), readText(test.stderr_path)]),
    ),
  ].join("\n");

  if (/no space left on device/i.test(infraText)) {
    return "infrastructure failure: no space left on device";
  }
  if (/ENOSPC/i.test(infraText)) {
    return "infrastructure failure: ENOSPC";
  }
  if (/authentication failed|not authenticated|permission denied \(publickey\)|401 unauthorized/i.test(infraText)) {
    return "infrastructure failure: authentication failure";
  }
  if (/could not resolve host|temporary failure in name resolution|network is unreachable|connection timed out/i.test(infraText)) {
    return "infrastructure failure: network failure";
  }

  return null;
}

function readText(path) {
  if (!path || !existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function ensureRepo(repoUrl, repoDir) {
  if (existsSync(resolve(repoDir, ".git"))) {
    git(repoDir, ["fetch", "origin", "--tags"]);
    return;
  }
  mkdirSync(dirname(repoDir), { recursive: true });
  const result = spawnSync("git", ["clone", repoUrl, repoDir], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git clone failed: ${result.stderr || result.stdout}`);
  }
}

function checkout(repoDir, commit) {
  git(repoDir, ["checkout", "-q", commit]);
  git(repoDir, ["clean", "-fdx", "-q"]);
  sanitizeWorkspaceInstructions(repoDir);
}

function git(repoDir, args) {
  const result = spawnSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function sanitizeWorkspaceInstructions(repoDir) {
  for (const relativePath of ["AGENTS.md", "agents.md", "CLAUDE.md", "claude.md", ".agents", ".claude", ".codex"]) {
    rmSync(resolve(repoDir, relativePath), { recursive: true, force: true });
  }
}

function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();

    while (stack.length > 1 && indent <= stack.at(-1).indent) {
      stack.pop();
    }
    const parent = stack.at(-1).value;

    if (line.startsWith("- ")) {
      if (!Array.isArray(parent)) {
        throw new Error(`unsupported YAML list at ${basename(casePath)}:${i + 1}`);
      }
      const itemText = line.slice(2);
      if (itemText.includes(": ")) {
        const obj = {};
        parent.push(obj);
        const [key, value] = splitKeyValue(itemText);
        obj[key] = parseScalar(value);
        stack.push({ indent, value: obj });
      } else {
        parent.push(parseScalar(itemText));
      }
      continue;
    }

    const [key, value] = splitKeyValue(line);
    if (value === "") {
      const next = nextMeaningfulLine(lines, i + 1);
      const container = next?.trim().startsWith("- ") ? [] : {};
      parent[key] = container;
      stack.push({ indent, value: container });
    } else if (value === ">") {
      const blockLines = [];
      const blockIndent = nextMeaningfulLine(lines, i + 1)?.match(/^ */)?.[0].length ?? indent + 2;
      i += 1;
      while (i < lines.length) {
        const blockRaw = lines[i];
        if (blockRaw.trim() && blockRaw.match(/^ */)[0].length < blockIndent) {
          i -= 1;
          break;
        }
        blockLines.push(blockRaw.slice(Math.min(blockIndent, blockRaw.length)));
        i += 1;
      }
      parent[key] = blockLines.join(" ").replace(/\s+/g, " ").trim();
    } else {
      parent[key] = parseScalar(value);
    }
  }
  return root;
}

function splitKeyValue(line) {
  const index = line.indexOf(":");
  if (index === -1) throw new Error(`unsupported YAML line: ${line}`);
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

function nextMeaningfulLine(lines, start) {
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].trim() && !lines[i].trim().startsWith("#")) return lines[i];
  }
  return null;
}

function parseScalar(value) {
  if (value === "[]") return [];
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((part) => parseScalar(part.trim()));
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function required(value, message) {
  if (value === undefined || value === null || value === "") fatal(message);
  return value;
}

function defaultConditionId({ harness, model, effort }) {
  if (!harness) return null;
  return [harness, model, effort].filter(Boolean).join(":");
}

function fatal(message) {
  console.error(message);
  process.exit(2);
}
