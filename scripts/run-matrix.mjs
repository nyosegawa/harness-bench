#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const runsRoot = resolve(args.runsRoot ?? "benchmark/runs");
const workRoot = resolve(args.workRoot ?? "benchmark/workspaces");
const containerCacheRoot = resolve(args.containerCacheRoot ?? "benchmark/cache/container");
const agentTimeoutMs = Number(args.agentTimeoutMs ?? 3600000);
const rateCard = args.rateCard ? resolve(args.rateCard) : null;
const dryRun = parseBoolean(args.dryRun, false);
const stopOnFailure = parseBoolean(args.stopOnFailure, false);
const includeVerify = parseBoolean(args.includeVerify, false);
const includeAgents = parseBoolean(args.includeAgents, true);
const maxInfraRetries = Number(args.maxInfraRetries ?? 0);
const jobsConcurrency = Math.max(1, Number(args.jobs ?? 1));
const experimentId = args.experimentId ?? null;
const matrixId = args.matrixId ?? experimentId ?? `matrix-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const experimentDir = experimentId ? resolve(args.experimentsRoot ?? "benchmark/experiments", experimentId) : null;
const writeReport = parseBoolean(args.report, Boolean(experimentId));
const review = parseBoolean(args.review, false);

if ((writeReport || review) && !experimentId) {
  fatal("--report/--review require --experimentId so artifacts are immutable");
}
if (!dryRun && experimentDir && existsSync(experimentDir) && readdirSync(experimentDir).length > 0) {
  fatal(`experiment directory already exists and is not empty: ${experimentDir}`);
}

const cases = collectCases(args).map((path) => resolve(path));
if (cases.length === 0) {
  fatal("no cases found; pass --case <path> or add case YAML files under benchmark/cases");
}

const requestedHarnesses = listArg(args.harness);
const conditions = loadConditions(args.conditions ?? "benchmark/conditions/baseline.json").filter((condition) =>
  requestedHarnesses.length === 0 || requestedHarnesses.includes(condition.harness),
);
if (conditions.length === 0) {
  fatal(`no matching harness conditions for --harness ${requestedHarnesses.join(",")}`);
}

const jobs = [];
if (includeVerify) {
  for (const casePath of cases) {
    jobs.push({ kind: "verify", casePath, mode: "verify-base" });
    jobs.push({ kind: "verify", casePath, mode: "verify-fixed" });
  }
}
if (includeAgents) {
  for (const casePath of cases) {
    for (const condition of conditions) {
      jobs.push({ kind: "agent", casePath, condition });
    }
  }
}
if (jobs.length === 0) {
  fatal("matrix has no jobs; enable --includeVerify or --includeAgents");
}

const startedAt = new Date();
const summary = {
  schema_version: 1,
  matrix_id: matrixId,
  started_at: startedAt.toISOString(),
  finished_at: null,
  dry_run: dryRun,
  include_verify: includeVerify,
  include_agents: includeAgents,
  stop_on_failure: stopOnFailure,
  runs_root: runsRoot,
  work_root: workRoot,
  container_cache_root: containerCacheRoot,
  agent_timeout_ms: agentTimeoutMs,
  max_infra_retries: maxInfraRetries,
  jobs_concurrency: jobsConcurrency,
  experiment_id: experimentId,
  experiment_dir: experimentDir,
  report: writeReport,
  review,
  rate_card: rateCard,
  cases,
  conditions,
  harness_version_snapshots: {},
  jobs: [],
  success: false,
};

const harnessVersionSnapshots = includeAgents && !dryRun
  ? captureHarnessVersionSnapshots([...new Set(conditions.map((condition) => condition.harness))])
  : {};
summary.harness_version_snapshots = harnessVersionSnapshots;

console.log(JSON.stringify({
  dryRun,
  matrixId,
  jobs: jobs.length,
  concurrency: jobsConcurrency,
  cases: cases.length,
  conditions: conditions.map((condition) => condition.id),
}, null, 2));

let failed = false;
for (const jobRecord of await runJobs(jobs)) {
  summary.jobs.push(jobRecord);
  if (jobRecord.failed) failed = true;
}

async function runJobs(pendingJobs) {
  if (jobsConcurrency === 1) {
    const records = [];
    for (const job of pendingJobs) {
      const record = await runJob(job);
      records.push(record);
      if (record.failed && stopOnFailure) break;
    }
    return records;
  }

  const pending = [...pendingJobs];
  const records = [];
  const active = new Set();
  const activeResources = new Set();

  return await new Promise((resolvePromise) => {
    const pump = () => {
      while (active.size < jobsConcurrency && pending.length > 0 && !(failed && stopOnFailure)) {
        const index = pending.findIndex((job) => !activeResources.has(jobResourceKey(job)));
        if (index === -1) break;
        const [job] = pending.splice(index, 1);
        const resourceKey = jobResourceKey(job);
        activeResources.add(resourceKey);
        const promise = runJob(job)
          .then((record) => {
            records.push(record);
            if (record.failed) failed = true;
          })
          .finally(() => {
            active.delete(promise);
            activeResources.delete(resourceKey);
            if ((pending.length === 0 || (failed && stopOnFailure)) && active.size === 0) {
              resolvePromise(records);
            } else {
              pump();
            }
          });
        active.add(promise);
      }
      if ((pending.length === 0 || (failed && stopOnFailure)) && active.size === 0) {
        resolvePromise(records);
      }
    };
    pump();
  });
}

async function runJob(job) {
  const label = job.kind === "agent"
    ? `${basename(job.casePath)} ${job.condition.id}`
    : `${basename(job.casePath)} ${job.mode}`;
  const attempts = [];
  let finalRecord = null;
  const allowedAttempts = job.kind === "agent" ? maxInfraRetries + 1 : 1;

  for (let attempt = 1; attempt <= allowedAttempts; attempt += 1) {
    const command = buildCommand(job, attempt);
    console.log(`\n==> ${label}${allowedAttempts > 1 ? ` attempt ${attempt}/${allowedAttempts}` : ""}`);
    console.log(shellJoin(command));
    const record = await runJobAttempt(job, command, attempt);
    attempts.push(record);
    finalRecord = record;
    if (!record.invalid_run) break;
  }

  const jobRecord = {
    label,
    kind: job.kind,
    case_path: job.casePath,
    condition_id: job.condition?.id ?? null,
    mode: job.mode ?? (job.kind === "agent" ? "agent" : null),
    attempts,
    final: finalRecord,
  };

  if (finalRecord && isMatrixFailure(job, finalRecord)) {
    failed = true;
    jobRecord.failed = true;
    jobRecord.failure_reason = failureReason(job, finalRecord);
  }

  return jobRecord;
}

summary.finished_at = new Date().toISOString();
summary.duration_ms = new Date(summary.finished_at).getTime() - startedAt.getTime();
summary.success = !failed;

const summaryPath = resolve(runsRoot, `matrix-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
if (!dryRun) {
  mkdirSync(runsRoot, { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (experimentDir) {
    await writeExperimentArtifacts(summary, summaryPath);
  }
}
console.log(JSON.stringify({ success: summary.success, summaryPath: dryRun ? null : summaryPath }, null, 2));
process.exit(summary.success ? 0 : 1);

async function writeExperimentArtifacts(matrixSummary, summaryPath) {
  mkdirSync(experimentDir, { recursive: true });
  const manifest = buildExperimentManifest(matrixSummary, summaryPath);
  writeFileSync(resolve(experimentDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(resolve(experimentDir, "summary.json"), `${JSON.stringify(buildExperimentSummary(matrixSummary), null, 2)}\n`);

  const reviewFile = resolve(experimentDir, "failure-reviews.json");
  if (review) {
    await runAuxiliaryCommand([
      process.execPath,
      "scripts/review-failed-runs.mjs",
      "--runsRoot",
      runsRoot,
      "--containerCacheRoot",
      containerCacheRoot,
      "--matrixId",
      matrixId,
      "--output",
      reviewFile,
      "--generate",
      "--jobs",
      String(Math.min(jobsConcurrency, Number(args.reviewJobs ?? jobsConcurrency))),
    ]);
  } else {
    writeFileSync(reviewFile, `${JSON.stringify(emptyReviewFile(), null, 2)}\n`);
  }

  if (writeReport) {
    await runAuxiliaryCommand([
      process.execPath,
      "scripts/render-results.mjs",
      "--runsRoot",
      runsRoot,
      "--output",
      resolve(experimentDir, "results.html"),
      "--matrixId",
      matrixId,
      "--reviewFile",
      reviewFile,
    ]);
    await runAuxiliaryCommand([
      process.execPath,
      "scripts/render-experiment-index.mjs",
      "--experimentsRoot",
      args.experimentsRoot ?? "benchmark/experiments",
      "--output",
      "benchmark/reports/index.html",
    ]);
  }
}

function buildExperimentManifest(matrixSummary, summaryPath) {
  const runEntries = matrixSummary.jobs.flatMap((job) => job.attempts.map((attempt) => runManifestEntry(job, attempt)).filter(Boolean));
  return {
    schema_version: 1,
    experiment_id: experimentId,
    matrix_id: matrixId,
    created_at: new Date().toISOString(),
    started_at: matrixSummary.started_at,
    finished_at: matrixSummary.finished_at,
    success: matrixSummary.success,
    runner: {
      git_commit: gitOutput(["rev-parse", "HEAD"]),
      git_status_short: gitOutput(["status", "--short"]),
      run_matrix_script_sha256: fileSha256("scripts/run-matrix.mjs"),
      run_case_script_sha256: fileSha256("scripts/run-case.mjs"),
      render_results_script_sha256: fileSha256("scripts/render-results.mjs"),
      review_failed_runs_script_sha256: fileSha256("scripts/review-failed-runs.mjs"),
    },
    inputs: {
      cases: cases.map((casePath) => caseManifestEntry(casePath)),
      conditions,
      conditions_file: args.conditions ? resolve(args.conditions) : resolve("benchmark/conditions/baseline.json"),
      conditions_file_sha256: fileSha256(args.conditions ? resolve(args.conditions) : "benchmark/conditions/baseline.json"),
      rate_card: rateCard ? { path: rateCard, sha256: fileSha256(rateCard) } : null,
      include_verify: includeVerify,
      include_agents: includeAgents,
      agent_timeout_ms: agentTimeoutMs,
      container_cache_root: containerCacheRoot,
      max_infra_retries: maxInfraRetries,
      jobs_concurrency: jobsConcurrency,
    },
    artifacts: {
      matrix_summary_path: summaryPath,
      report_path: writeReport ? resolve(experimentDir, "results.html") : null,
      failure_reviews_path: resolve(experimentDir, "failure-reviews.json"),
    },
    harness_versions: summarizeHarnessVersions(runEntries),
    harness_version_drift_detected: hasHarnessVersionDrift(runEntries),
    runs: runEntries,
  };
}

function runManifestEntry(job, attempt) {
  if (!attempt.run_dir) return null;
  const promptBundlePath = resolve(attempt.run_dir, "prompt-bundle.json");
  const resultPath = attempt.result_path ? resolve(attempt.result_path) : resolve(attempt.run_dir, "result.json");
  const result = readResultJson(resultPath);
  return {
    run_id: basename(attempt.run_dir),
    kind: job.kind,
    case_path: job.case_path,
    condition_id: job.condition_id ?? null,
    attempt: attempt.attempt,
    run_dir: attempt.run_dir,
    result_path: resultPath,
    result_sha256: fileSha256(resultPath),
    prompt_bundle_path: existsSync(promptBundlePath) ? promptBundlePath : null,
    prompt_bundle_sha256: fileSha256(promptBundlePath),
    invalid_run: attempt.invalid_run ?? false,
    harness: result?.harness ?? null,
    model: result?.model ?? null,
    effort: result?.effort ?? null,
    harness_version: result?.harness_version ?? result?.agent_result?.harness_version ?? null,
  };
}

function summarizeHarnessVersions(runEntries) {
  const byHarness = new Map();
  for (const entry of runEntries) {
    const version = entry.harness_version;
    if (!entry.harness || !version) continue;
    const group = byHarness.get(entry.harness) ?? {
      name: entry.harness,
      versions: new Map(),
      first_seen_at: null,
      last_seen_at: null,
    };
    const key = [
      version.version_string ?? "",
      version.binary_sha256 ?? "",
      version.binary_path ?? "",
    ].join("\0");
    const versionGroup = group.versions.get(key) ?? {
      version_string: version.version_string ?? null,
      binary_path: version.binary_path ?? null,
      binary_sha256: version.binary_sha256 ?? null,
      raw_version_output: version.raw_version_output ?? null,
      runs: 0,
    };
    versionGroup.runs += 1;
    group.versions.set(key, versionGroup);
    const capturedAt = version.captured_at ?? null;
    if (capturedAt && (!group.first_seen_at || capturedAt < group.first_seen_at)) group.first_seen_at = capturedAt;
    if (capturedAt && (!group.last_seen_at || capturedAt > group.last_seen_at)) group.last_seen_at = capturedAt;
    byHarness.set(entry.harness, group);
  }
  return Object.fromEntries([...byHarness.entries()].map(([name, group]) => [name, {
    name,
    first_seen_at: group.first_seen_at,
    last_seen_at: group.last_seen_at,
    versions: [...group.versions.values()],
  }]));
}

function hasHarnessVersionDrift(runEntries) {
  return Object.values(summarizeHarnessVersions(runEntries)).some((group) => group.versions.length > 1);
}

function buildExperimentSummary(matrixSummary) {
  const finalAgentRecords = matrixSummary.jobs
    .filter((job) => job.kind === "agent")
    .map((job) => readResultJson(job.final?.result_path))
    .filter(Boolean)
    .filter((result) => !result.invalid_run);
  const byCondition = groupBy(finalAgentRecords, (result) => result.condition_id ?? result.harness ?? "unknown");
  const conditionsSummary = Object.fromEntries([...byCondition.entries()].map(([conditionId, group]) => {
    const passed = group.filter((result) => result.success).length;
    const costValues = group.map((result) => result.metrics?.usage?.cost_usd).filter((value) => typeof value === "number");
    return [conditionId, {
      runs: group.length,
      passed,
      pass_rate: group.length ? passed / group.length : null,
      median_wall_time_ms: median(group.map((result) => result.metrics?.wall_time_ms).filter((value) => typeof value === "number")),
      cost_usd: costValues.length ? sum(costValues) : null,
    }];
  }));
  return {
    schema_version: 1,
    experiment_id: experimentId,
    matrix_id: matrixId,
    started_at: matrixSummary.started_at,
    finished_at: matrixSummary.finished_at,
    duration_ms: matrixSummary.duration_ms,
    success: matrixSummary.success,
    jobs: matrixSummary.jobs.length,
    agent_runs: finalAgentRecords.length,
    passed: finalAgentRecords.filter((result) => result.success).length,
    invalid_runs: matrixSummary.jobs.filter((job) => job.final?.invalid_run).length,
    conditions: conditionsSummary,
    failures: finalAgentRecords
      .filter((result) => !result.success)
      .map((result) => ({
        case_id: result.case_id,
        harness: result.harness,
        condition_id: result.condition_id,
        run_id: result.run_id,
      }))
      .sort((a, b) => a.case_id.localeCompare(b.case_id) || a.harness.localeCompare(b.harness)),
  };
}

function caseManifestEntry(casePath) {
  const text = readFileSync(casePath, "utf8");
  return {
    path: casePath,
    relative_path: relative(process.cwd(), casePath),
    sha256: sha256(text),
    id: text.match(/^id:\s*(.+)$/m)?.[1]?.trim() ?? null,
    repo: text.match(/^repo:\s*(.+)$/m)?.[1]?.trim() ?? null,
    difficulty: text.match(/^difficulty:\s*(.+)$/m)?.[1]?.trim() ?? null,
    base_commit: text.match(/^base_commit:\s*(.+)$/m)?.[1]?.trim() ?? null,
    fixed_commit: text.match(/^fixed_commit:\s*(.+)$/m)?.[1]?.trim() ?? null,
  };
}

function runAuxiliaryCommand(command) {
  console.log(`\n==> ${shellJoin(command)}`);
  const result = spawn(command[0], command.slice(1), {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  return new Promise((resolvePromise, rejectPromise) => {
    result.on("error", rejectPromise);
    result.on("close", (code, signal) => {
      if (code !== 0) {
        rejectPromise(new Error(`${shellJoin(command)} failed with ${code ?? signal}`));
      } else {
        resolvePromise();
      }
    });
  });
}

function emptyReviewFile() {
  return {
    schema_version: 1,
    scope: `experiment:${experimentId}`,
    judge_role: {
      en: "Auxiliary implementation review only. Hidden tests remain the source of pass/fail truth.",
      ja: "補助的な実装レビューのみ。pass/fail の基準は hidden test のままです。",
    },
    generated_at: new Date().toISOString(),
    reviews: [],
  };
}

function gitOutput(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function fileSha256(path) {
  const resolved = resolve(path);
  return existsSync(resolved) ? sha256(readFileSync(resolved)) : null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function groupBy(values, keyFn) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFn(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

function runJobAttempt(job, command, attempt) {
  const record = {
    attempt,
    command,
    started_at: new Date().toISOString(),
    finished_at: null,
    exit_code: null,
    signal: null,
    duration_ms: null,
  };

  if (dryRun) {
    record.finished_at = new Date().toISOString();
    return Promise.resolve(record);
  }

  const startedMs = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      stderr += error.stack ?? error.message;
    });
    child.on("close", (code, signal) => {
      record.duration_ms = Date.now() - startedMs;
      record.exit_code = code;
      record.signal = signal;
      const runCase = parseRunCaseStdout(stdout);
      record.result_path = runCase?.resultPath ?? null;
      record.run_dir = runCase?.runDir ?? null;
      record.result_success = runCase?.success ?? null;
      const completedResult = readResultJson(record.result_path);
      record.case_id = completedResult?.case_id ?? null;
      record.runner_error = completedResult?.error?.message ?? null;
      record.invalid_run = completedResult?.invalid_run ?? false;
      record.invalid_reason = completedResult?.invalid_reason ?? null;
      record.agent_timed_out = completedResult?.agent_result?.timed_out ?? false;
      record.finished_at = new Date().toISOString();
      if (!record.result_path && stderr) {
        record.stderr_tail = stderr.split(/\r?\n/).slice(-20).join("\n");
      }
      resolvePromise(record);
    });
  });
}

function jobResourceKey(job) {
  if (job.kind === "verify") return `verify:${repoSlugForCase(job.casePath)}`;
  return `agent:${job.casePath}:${job.condition?.id ?? ""}`;
}

function repoSlugForCase(casePath) {
  const text = readFileSync(casePath, "utf8");
  const repo = text.match(/^repo:\s*(.+)$/m)?.[1]?.trim() ?? casePath;
  return repo.replace("/", "__");
}

function buildCommand(job, attempt) {
  const command = [
    process.execPath,
    "scripts/run-case.mjs",
    "--case",
    job.casePath,
    "--mode",
    job.kind === "verify" ? job.mode : "agent",
    "--workRoot",
    workRoot,
    "--runsRoot",
    runsRoot,
    "--matrixId",
    matrixId,
    "--attempt",
    String(attempt),
  ];

  if (job.kind === "agent") {
    command.push(
      "--harness",
      job.condition.harness,
      "--model",
      job.condition.model,
      "--conditionId",
      job.condition.id,
      "--agentTimeoutMs",
      String(agentTimeoutMs),
    );
    if (job.condition.effort) {
      command.push("--effort", job.condition.effort);
    }
    if (job.condition.cursor_config) {
      command.push("--cursorConfig", JSON.stringify(job.condition.cursor_config));
    }
    if (job.condition.prompt_template_id) {
      command.push("--promptTemplateId", job.condition.prompt_template_id);
    }
    if (harnessVersionSnapshots[job.condition.harness]) {
      command.push("--harnessVersion", JSON.stringify(harnessVersionSnapshots[job.condition.harness]));
    }
    if (rateCard) {
      command.push("--rateCard", rateCard);
    }
  }

  return command;
}

function captureHarnessVersionSnapshots(harnesses) {
  return Object.fromEntries(harnesses.map((harness) => [harness, captureHarnessVersion(harness)]));
}

function captureHarnessVersion(harnessName) {
  const binary = harnessBinary(harnessName);
  const capturedAt = new Date().toISOString();
  const version = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  const which = spawnSync("which", [binary], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const binaryPath = which.status === 0 ? which.stdout.trim() : null;
  return {
    name: harnessName,
    version_string: firstNonEmptyLine(`${version.stdout ?? ""}\n${version.stderr ?? ""}`),
    binary_path: binaryPath,
    binary_sha256: binaryPath ? fileSha256(binaryPath) : null,
    captured_at: capturedAt,
    raw_version_output: `${version.stdout ?? ""}${version.stderr ?? ""}`,
    version_exit_code: version.status,
    version_signal: version.signal,
    version_error: version.error?.message ?? null,
  };
}

function harnessBinary(harnessName) {
  if (harnessName === "codex") return "codex";
  if (harnessName === "claude") return "claude";
  if (harnessName === "cursor") return "agent";
  return harnessName;
}

function firstNonEmptyLine(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function loadConditions(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    fatal(`conditions file not found: ${resolved}`);
  }
  const data = JSON.parse(readFileSync(resolved, "utf8"));
  const conditions = Array.isArray(data) ? data : data.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) {
    fatal(`conditions file has no conditions: ${resolved}`);
  }
  return conditions.map((condition) => ({
    id: condition.id ?? [condition.harness, condition.model, condition.effort].filter(Boolean).join(":"),
    harness: requiredCondition(condition.harness, "harness"),
    model: requiredCondition(condition.model, "model"),
    effort: condition.effort ?? null,
    cursor_config: condition.cursor_config ?? null,
    context: condition.context ?? null,
    max_mode: condition.max_mode ?? null,
    prompt_template_id: condition.prompt_template_id ?? data.prompt_template_id ?? null,
    prompt_policy: condition.prompt_policy ?? data.prompt_policy ?? null,
    workspace_policy: condition.workspace_policy ?? data.workspace_policy ?? null,
  }));
}

function collectCases(parsedArgs) {
  const explicit = listArg(parsedArgs.case);
  const fromFile = listArg(parsedArgs.casesFrom).flatMap((path) =>
    readFileSync(resolve(path), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
  const combined = [...explicit, ...fromFile];
  if (combined.length > 0) return [...new Set(combined)];
  return findYamlCases(resolve("benchmark/cases"));
}

function parseRunCaseStdout(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readResultJson(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isMatrixFailure(job, record) {
  if (dryRun) return false;
  if (record.runner_error) return true;
  if (record.invalid_run) return true;
  if (!record.result_path || !existsSync(record.result_path)) return true;
  if (job.kind === "agent") return false;
  if (job.mode === "verify-base") return record.result_success !== false;
  if (job.mode === "verify-fixed") return record.result_success !== true;
  return record.exit_code !== 0;
}

function failureReason(job, record) {
  if (record.runner_error) return `runner error: ${record.runner_error}`;
  if (record.invalid_run) return record.invalid_reason ?? "invalid run";
  if (!record.result_path || !existsSync(record.result_path)) return "missing result.json";
  if (job.kind === "agent") return "agent run did not complete";
  if (job.mode === "verify-base") return "verify-base unexpectedly passed";
  if (job.mode === "verify-fixed") return "verify-fixed failed";
  return `unexpected exit code ${record.exit_code}`;
}

function requiredCondition(value, field) {
  if (value == null || value === "") fatal(`condition missing ${field}`);
  return value;
}

function findYamlCases(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) return findYamlCases(path);
      if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) return [path];
      return [];
    })
    .sort();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fatal(`unexpected argument ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else if (parsed[key] == null) {
      parsed[key] = next;
      index += 1;
    } else if (Array.isArray(parsed[key])) {
      parsed[key].push(next);
      index += 1;
    } else {
      parsed[key] = [parsed[key], next];
      index += 1;
    }
  }
  return parsed;
}

function listArg(value) {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
}

function parseBoolean(value, defaultValue) {
  if (value == null) return defaultValue;
  if (["1", "true", "yes"].includes(String(value).toLowerCase())) return true;
  if (["0", "false", "no"].includes(String(value).toLowerCase())) return false;
  fatal(`invalid boolean value ${value}`);
}

function shellJoin(command) {
  return command.map(shellQuote).join(" ");
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function fatal(message) {
  console.error(message);
  process.exit(1);
}
