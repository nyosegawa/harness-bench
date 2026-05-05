#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const matrixId = required(args.matrixId, "--matrixId <id> is required");
const runsRoot = resolve(args.runsRoot ?? "benchmark/runs");
const workRoot = resolve(args.workRoot ?? "benchmark/workspaces");
const conditionsPath = resolve(args.conditions ?? "benchmark/conditions/baseline.json");
const rateCard = args.rateCard ? resolve(args.rateCard) : null;
const agentTimeoutMs = Number(args.agentTimeoutMs ?? 3600000);
const jobsConcurrency = Math.max(1, Number(args.jobs ?? 1));
const minFreeGb = Number(args.minFreeGb ?? 0);
const dryRun = parseBoolean(args.dryRun, false);
const maxInfraRetries = Number(args.maxInfraRetries ?? 0);
const summaryPath = args.summary ? resolve(args.summary) : resolve(runsRoot, `resume-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

const cases = collectCases(args).map((path) => resolve(path));
const conditions = loadConditions(conditionsPath);
const completed = loadCompletedAgentPairs(runsRoot, matrixId);
const jobs = [];
for (const casePath of cases) {
  const caseId = caseIdFromYaml(casePath);
  for (const condition of conditions) {
    const key = pairKey(caseId, condition.id);
    if (!completed.has(key)) {
      jobs.push({ casePath, caseId, condition });
    }
  }
}

const harnessVersionSnapshots = !dryRun
  ? captureHarnessVersionSnapshots([...new Set(jobs.map((job) => job.condition.harness))])
  : {};

const summary = {
  schema_version: 1,
  kind: "resume-agent-matrix",
  matrix_id: matrixId,
  started_at: new Date().toISOString(),
  finished_at: null,
  dry_run: dryRun,
  runs_root: runsRoot,
  work_root: workRoot,
  conditions_file: conditionsPath,
  conditions_file_sha256: fileSha256(conditionsPath),
  rate_card: rateCard,
  agent_timeout_ms: agentTimeoutMs,
  jobs_concurrency: jobsConcurrency,
  max_infra_retries: maxInfraRetries,
  min_free_gb: minFreeGb,
  cases_total: cases.length,
  conditions_total: conditions.length,
  completed_agent_pairs_before: completed.size,
  pending_agent_pairs_before: jobs.length,
  harness_version_snapshots: harnessVersionSnapshots,
  jobs: [],
  success: false,
};

console.log(JSON.stringify({
  dryRun,
  matrixId,
  cases: cases.length,
  conditions: conditions.length,
  completed: completed.size,
  pending: jobs.length,
  concurrency: jobsConcurrency,
  minFreeGb,
}, null, 2));

let failed = false;
const records = await runJobs(jobs);
summary.jobs = records;
summary.finished_at = new Date().toISOString();
summary.duration_ms = new Date(summary.finished_at).getTime() - new Date(summary.started_at).getTime();
summary.success = !failed;
summary.completed_agent_pairs_after = loadCompletedAgentPairs(runsRoot, matrixId).size;
summary.pending_agent_pairs_after = cases.length * conditions.length - summary.completed_agent_pairs_after;

if (!dryRun) {
  mkdirSync(runsRoot, { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
}

console.log(JSON.stringify({ success: summary.success, summaryPath: dryRun ? null : summaryPath }, null, 2));
process.exit(summary.success ? 0 : 1);

async function runJobs(pendingJobs) {
  if (jobsConcurrency === 1) {
    const serial = [];
    for (const job of pendingJobs) {
      const record = await runJob(job);
      serial.push(record);
    }
    return serial;
  }

  const pending = [...pendingJobs];
  const records = [];
  const active = new Set();
  const activeResources = new Set();

  return await new Promise((resolvePromise) => {
    const pump = () => {
      while (active.size < jobsConcurrency && pending.length > 0) {
        const index = pending.findIndex((job) => !activeResources.has(jobResourceKey(job)));
        if (index === -1) break;
        const [job] = pending.splice(index, 1);
        const resourceKey = jobResourceKey(job);
        activeResources.add(resourceKey);
        const promise = runJob(job)
          .then((record) => {
            records.push(record);
          })
          .finally(() => {
            active.delete(promise);
            activeResources.delete(resourceKey);
            if (pending.length === 0 && active.size === 0) {
              resolvePromise(records);
            } else {
              pump();
            }
          });
        active.add(promise);
      }
      if (pending.length === 0 && active.size === 0) {
        resolvePromise(records);
      }
    };
    pump();
  });
}

async function runJob(job) {
  const label = `${basename(job.casePath)} ${job.condition.id}`;
  const attempts = [];
  let finalRecord = null;
  const allowedAttempts = maxInfraRetries + 1;

  for (let attempt = 1; attempt <= allowedAttempts; attempt += 1) {
    ensureFreeSpace();
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
    kind: "agent",
    case_path: job.casePath,
    case_id: job.caseId,
    condition_id: job.condition.id,
    attempts,
    final: finalRecord,
  };

  if (finalRecord?.missing_result || finalRecord?.runner_error || finalRecord?.invalid_run) {
    failed = true;
    jobRecord.failed = true;
    jobRecord.failure_reason = finalRecord.invalid_reason ?? finalRecord.runner_error ?? "missing result.json";
  }
  return jobRecord;
}

function buildCommand(job, attempt) {
  const command = [
    process.execPath,
    "scripts/run-case.mjs",
    "--case",
    job.casePath,
    "--mode",
    "agent",
    "--workRoot",
    workRoot,
    "--runsRoot",
    runsRoot,
    "--matrixId",
    matrixId,
    "--attempt",
    String(attempt),
    "--harness",
    job.condition.harness,
    "--model",
    job.condition.model,
    "--conditionId",
    job.condition.id,
    "--agentTimeoutMs",
    String(agentTimeoutMs),
  ];
  if (job.condition.effort) command.push("--effort", job.condition.effort);
  if (job.condition.cursor_config) command.push("--cursorConfig", JSON.stringify(job.condition.cursor_config));
  if (job.condition.prompt_template_id) command.push("--promptTemplateId", job.condition.prompt_template_id);
  if (harnessVersionSnapshots[job.condition.harness]) {
    command.push("--harnessVersion", JSON.stringify(harnessVersionSnapshots[job.condition.harness]));
  }
  if (rateCard) command.push("--rateCard", rateCard);
  return command;
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
    result_path: null,
    run_dir: null,
    result_success: null,
    invalid_run: false,
    invalid_reason: null,
    agent_timed_out: false,
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
      const result = readResultJson(record.result_path);
      record.invalid_run = result?.invalid_run ?? false;
      record.invalid_reason = result?.invalid_reason ?? null;
      record.agent_timed_out = result?.agent_result?.timed_out ?? false;
      record.runner_error = result?.error?.message ?? null;
      record.missing_result = !record.result_path || !existsSync(record.result_path);
      if (record.missing_result && stderr) {
        record.stderr_tail = stderr.split(/\r?\n/).slice(-20).join("\n");
      }
      record.finished_at = new Date().toISOString();
      resolvePromise(record);
    });
  });
}

function jobResourceKey(job) {
  if (job.condition?.harness === "cursor" && job.condition.cursor_config) return "agent:cursor-cli-config";
  return `agent:${job.casePath}:${job.condition?.id ?? ""}`;
}

function loadCompletedAgentPairs(root, id) {
  const completed = new Set();
  for (const resultPath of findResultJsons(root)) {
    const result = readResultJson(resultPath);
    if (!result || result.matrix_id !== id || result.mode !== "agent") continue;
    if (!result.case_id || !result.condition_id) continue;
    completed.add(pairKey(result.case_id, result.condition_id));
  }
  return completed;
}

function findResultJsons(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(root, entry.name, "result.json"))
    .filter((path) => existsSync(path));
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

function loadConditions(path) {
  const data = JSON.parse(readFileSync(resolve(path), "utf8"));
  const conditions = Array.isArray(data) ? data : data.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) {
    fatal(`conditions file has no conditions: ${path}`);
  }
  return conditions.map((condition) => ({
    id: condition.id ?? [condition.harness, condition.model, condition.effort].filter(Boolean).join(":"),
    harness: required(condition.harness, "condition.harness is required"),
    model: required(condition.model, "condition.model is required"),
    effort: condition.effort ?? null,
    cursor_config: condition.cursor_config ?? null,
    prompt_template_id: condition.prompt_template_id ?? data.prompt_template_id ?? null,
  }));
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

function ensureFreeSpace() {
  if (!minFreeGb) return;
  const free = freeGb("/");
  if (free == null) return;
  if (free < minFreeGb) {
    fatal(`free disk space ${free.toFixed(1)}GB is below --minFreeGb ${minFreeGb}`);
  }
}

function freeGb(path) {
  const result = spawnSync("df", ["-Pk", path], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) return null;
  const line = result.stdout.trim().split(/\r?\n/).at(-1);
  const fields = line?.trim().split(/\s+/);
  const availableKb = Number(fields?.[3]);
  return Number.isFinite(availableKb) ? availableKb / 1024 / 1024 : null;
}

function caseIdFromYaml(path) {
  const text = readFileSync(path, "utf8");
  const match = text.match(/^id:\s*(.+)$/m);
  return match ? match[1].trim() : basename(path, ".yaml");
}

function pairKey(caseId, conditionId) {
  return `${caseId}\0${conditionId}`;
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

function fileSha256(path) {
  const resolved = resolve(path);
  return existsSync(resolved) ? createHash("sha256").update(readFileSync(resolved)).digest("hex") : null;
}

function firstNonEmptyLine(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
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

function required(value, message) {
  if (value == null || value === "") fatal(message);
  return value;
}

function fatal(message) {
  console.error(message);
  process.exit(1);
}

