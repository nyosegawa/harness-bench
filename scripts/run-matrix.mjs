#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const runsRoot = resolve(args.runsRoot ?? "benchmark/runs");
const workRoot = resolve(args.workRoot ?? "benchmark/workspaces");
const agentTimeoutMs = Number(args.agentTimeoutMs ?? 900000);
const rateCard = args.rateCard ? resolve(args.rateCard) : null;
const dryRun = parseBoolean(args.dryRun, false);
const stopOnFailure = parseBoolean(args.stopOnFailure, false);
const includeVerify = parseBoolean(args.includeVerify, false);
const maxInfraRetries = Number(args.maxInfraRetries ?? 0);
const matrixId = args.matrixId ?? `matrix-${new Date().toISOString().replace(/[:.]/g, "-")}`;

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
for (const casePath of cases) {
  for (const condition of conditions) {
    jobs.push({ kind: "agent", casePath, condition });
  }
}

const startedAt = new Date();
const summary = {
  schema_version: 1,
  matrix_id: matrixId,
  started_at: startedAt.toISOString(),
  finished_at: null,
  dry_run: dryRun,
  include_verify: includeVerify,
  stop_on_failure: stopOnFailure,
  runs_root: runsRoot,
  work_root: workRoot,
  agent_timeout_ms: agentTimeoutMs,
  max_infra_retries: maxInfraRetries,
  rate_card: rateCard,
  cases,
  conditions,
  jobs: [],
  success: false,
};

console.log(JSON.stringify({
  dryRun,
  matrixId,
  jobs: jobs.length,
  cases: cases.length,
  conditions: conditions.map((condition) => condition.id),
}, null, 2));

let failed = false;
for (const job of jobs) {
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
    const record = runJobAttempt(job, command, attempt);
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

  summary.jobs.push(jobRecord);
  if (jobRecord.failed && stopOnFailure) {
    break;
  }
}

summary.finished_at = new Date().toISOString();
summary.duration_ms = new Date(summary.finished_at).getTime() - startedAt.getTime();
summary.success = !failed;

const summaryPath = resolve(runsRoot, `matrix-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
if (!dryRun) {
  mkdirSync(runsRoot, { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
}
console.log(JSON.stringify({ success: summary.success, summaryPath: dryRun ? null : summaryPath }, null, 2));
process.exit(summary.success ? 0 : 1);

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
    return record;
  }

  const startedMs = Date.now();
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  record.duration_ms = Date.now() - startedMs;
  record.exit_code = result.status;
  record.signal = result.signal;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const runCase = parseRunCaseStdout(result.stdout);
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
  return record;
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
    if (rateCard) {
      command.push("--rateCard", rateCard);
    }
  }

  return command;
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
    prompt_policy: condition.prompt_policy ?? data.prompt_policy ?? null,
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
