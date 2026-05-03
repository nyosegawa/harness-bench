#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const runsRoot = resolve(args.runsRoot ?? "benchmark/runs");
const output = resolve(args.output ?? "benchmark/reviews/baseline-failure-reviews.json");
const reviewer = args.reviewer ?? "codex";
const dryRun = Boolean(args.dryRun);
const generate = Boolean(args.generate);
const reviewerModel = args.model ?? "gpt-5.5";
const jobsConcurrency = Math.max(1, Number(args.jobs ?? 1));

const failed = loadFailedBaselineResults(runsRoot);
const existing = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : defaultReviewFile();
const existingReviews = new Map((existing.reviews ?? []).map((review) => [reviewKey(review.case_id, review.harness), review]));
const reviewJobs = [];

for (const result of failed) {
  const key = reviewKey(result.case_id, result.harness);
  if (!args.force && existingReviews.has(key)) continue;
  const bundle = buildReviewBundle(result);
  if (dryRun) {
    console.log(JSON.stringify(bundle, null, 2));
    continue;
  }
  if (!generate) {
    throw new Error(`missing review ${key}; use --dryRun to inspect evidence or --generate to call ${reviewer}`);
  }
  reviewJobs.push({ key, bundle });
}

if (dryRun) {
  validateReviewFile(existing, output);
  console.log(`validated ${existing.reviews?.length ?? 0} existing reviews in ${output}`);
  process.exit(0);
}

for (const { key, review } of await runReviewJobs(reviewJobs)) {
  validateSingleReview(review, `${reviewer}:${key}`);
  existingReviews.set(key, review);
  console.log(`generated ${key}`);
}

const next = {
  ...existing,
  schema_version: 1,
  reviews: [...existingReviews.values()].sort((a, b) => a.case_id.localeCompare(b.case_id) || a.harness.localeCompare(b.harness)),
};
validateReviewFile(next, output);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(next, null, 2)}\n`);
console.log(`validated ${next.reviews.length} reviews in ${output}`);

async function runReviewJobs(jobs) {
  const pending = [...jobs];
  const completed = [];
  const active = new Set();
  return await new Promise((resolvePromise, rejectPromise) => {
    const pump = () => {
      while (active.size < jobsConcurrency && pending.length > 0) {
        const job = pending.shift();
        const promise = generateReview(job.bundle)
          .then((review) => completed.push({ key: job.key, review }))
          .catch(rejectPromise)
          .finally(() => {
            active.delete(promise);
            if (pending.length === 0 && active.size === 0) {
              resolvePromise(completed);
            } else {
              pump();
            }
          });
        active.add(promise);
      }
      if (pending.length === 0 && active.size === 0) {
        resolvePromise(completed);
      }
    };
    pump();
  });
}

function loadFailedBaselineResults(root) {
  const find = spawnSync("find", [root, "-mindepth", "2", "-maxdepth", "2", "-name", "result.json"], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (find.status !== 0) throw new Error(find.stderr || "find result.json failed");
  return find.stdout.split(/\r?\n/)
    .filter(Boolean)
    .map((path) => ({ path: resolve(path), result: JSON.parse(readFileSync(path, "utf8")) }))
    .filter(({ result }) => result.mode === "agent" && result.matrix_id && !result.invalid_run && !result.success)
    .map(({ path, result }) => ({ ...result, result_path: path }))
    .sort((a, b) => a.case_id.localeCompare(b.case_id) || String(a.harness).localeCompare(String(b.harness)));
}

function buildReviewBundle(result) {
  const runDir = dirname(result.result_path);
  const workspace = resolve(runDir, "workspace");
  const failingCore = result.test_result?.core?.find((test) => test.exit_code !== 0 || test.signal) ?? result.test_result?.core?.[0] ?? null;
  const changedFiles = git(workspace, ["diff", "--name-only"]).stdout.split(/\r?\n/).filter(Boolean).slice(0, 30);
  return {
    case_id: result.case_id,
    harness: result.harness,
    model: result.model,
    run_id: result.run_id,
    instruction: result.case_metadata?.instruction ?? null,
    failing_test: failingCore ? {
      command: failingCore.command,
      exit_code: failingCore.exit_code,
      signal: failingCore.signal,
      stderr_tail: tail(failingCore.stderr_path, 80),
      stdout_tail: tail(failingCore.stdout_path, 80),
    } : null,
    changed_files: changedFiles,
    diff_summary: git(workspace, ["diff", "--stat"]).stdout,
    diff_excerpt: git(workspace, ["diff", "--", ...changedFiles.slice(0, 12)]).stdout.slice(0, 60000),
    session_log_summary: summarizeSessionLog(runDir, result.harness),
    required_schema: {
      case_id: "string",
      harness: "codex|claude|cursor",
      verdict: "true_failure|oracle_false_negative|case_design_review|infra_failure",
      confidence: "low|medium|high",
      failure_mode: { en: "string", ja: "string" },
      evidence: { en: "string", ja: "string" },
      recommendation: { en: "string", ja: "string" },
    },
  };
}

function generateReview(bundle) {
  if (reviewer !== "codex") {
    throw new Error(`unsupported reviewer ${reviewer}; only codex is implemented`);
  }
  const prompt = [
    "You are producing an auxiliary failure implementation review for a debugging benchmark.",
    "Hidden tests remain the pass/fail source of truth. Do not relabel a run as pass just because the implementation looks plausible.",
    "Use the evidence bundle, including hidden-test output, workspace diff, and session-log summary.",
    "Return exactly one JSON object and no markdown.",
    "Schema:",
    JSON.stringify({
      case_id: "string",
      harness: "codex|claude|cursor",
      verdict: "true_failure|oracle_false_negative|case_design_review|infra_failure",
      confidence: "low|medium|high",
      failure_mode: { en: "string", ja: "string" },
      evidence: { en: "string", ja: "string" },
      recommendation: { en: "string", ja: "string" },
    }, null, 2),
    "Evidence bundle:",
    JSON.stringify(bundle, null, 2),
  ].join("\n\n");
  return spawnJson("codex", [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--disable", "memories",
    "--disable", "plugins",
    "--disable", "apps",
    "--sandbox", "read-only",
    "-m", reviewerModel,
    "-C", process.cwd(),
    prompt,
  ], {
    cwd: process.cwd(),
    timeout: Number(args.timeoutMs ?? 900000),
  }).then(parseJsonObject);
}

function spawnJson(command, commandArgs, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeout);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        rejectPromise(new Error(`${command} reviewer timed out after ${options.timeout}ms`));
        return;
      }
      if (code !== 0) {
        rejectPromise(new Error(`${command} reviewer failed (${code ?? signal}): ${stderr || stdout}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

function parseJsonObject(text) {
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`reviewer output did not contain JSON object: ${trimmed.slice(0, 1000)}`);
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function summarizeSessionLog(runDir, harness) {
  if (harness === "claude") {
    const raw = readJson(resolve(runDir, "harness.result.json"));
    return raw ? {
      num_turns: raw.num_turns ?? null,
      usage: raw.usage ?? null,
      result_tail: tailText(raw.result ?? "", 1200),
    } : null;
  }
  const events = readJsonl(resolve(runDir, "harness.events.jsonl"));
  if (events.length === 0) return null;
  return {
    event_count: events.length,
    event_types: countBy(events.map((event) => event.type)),
    tool_events: events.filter((event) => event.type === "tool_call" || event.item?.type === "command_execution" || event.item?.type === "file_change").slice(-20),
  };
}

function validateReviewFile(data, path) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${path}: root must be object`);
  if (!Array.isArray(data.reviews)) throw new Error(`${path}: reviews must be array`);
  const seen = new Set();
  for (const [index, review] of data.reviews.entries()) {
    validateSingleReview(review, `${path}: reviews[${index}]`);
    const key = reviewKey(review.case_id, review.harness);
    if (seen.has(key)) throw new Error(`${path}: duplicate ${key}`);
    seen.add(key);
  }
}

function validateSingleReview(review, prefix) {
  requireString(review.case_id, `${prefix}.case_id`);
  requireString(review.harness, `${prefix}.harness`);
  if (!["codex", "claude", "cursor"].includes(review.harness)) throw new Error(`${prefix}.harness invalid`);
  requireString(review.verdict, `${prefix}.verdict`);
  if (!["true_failure", "oracle_false_negative", "case_design_review", "infra_failure"].includes(review.verdict)) throw new Error(`${prefix}.verdict invalid`);
  if (review.confidence != null && !["low", "medium", "high"].includes(review.confidence)) throw new Error(`${prefix}.confidence invalid`);
  requireLocalized(review.failure_mode, `${prefix}.failure_mode`);
  requireLocalized(review.evidence, `${prefix}.evidence`);
  requireLocalized(review.recommendation, `${prefix}.recommendation`);
}

function defaultReviewFile() {
  return {
    schema_version: 1,
    scope: "baseline matrix",
    judge_role: {
      en: "Auxiliary implementation review only. Hidden tests remain the source of pass/fail truth.",
      ja: "補助的な実装レビューのみ。pass/fail の基準は hidden test のままです。",
    },
    generated_at: new Date().toISOString(),
    reviews: [],
  };
}

function git(cwd, args) {
  if (!existsSync(cwd)) return { stdout: "", stderr: "", status: 0 };
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) return { stdout: "", stderr: result.stderr ?? "", status: result.status };
  return result;
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { parse_error: true, line: line.slice(0, 500) }; }
  });
}

function tail(path, lineCount) {
  if (!path || !existsSync(path)) return "";
  return readFileSync(path, "utf8").split(/\r?\n/).slice(-lineCount).join("\n");
}

function tailText(text, maxLength) {
  return String(text).slice(-maxLength);
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function reviewKey(caseId, harness) {
  return `${caseId}::${harness}`;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
}

function requireLocalized(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be object`);
  requireString(value.en, `${name}.en`);
  requireString(value.ja, `${name}.ja`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument ${arg}`);
    const key = arg.slice(2);
    if (key === "dryRun" || key === "force" || key === "generate") {
      parsed[key] = true;
    } else {
      parsed[key] = argv[++index];
    }
  }
  return parsed;
}
