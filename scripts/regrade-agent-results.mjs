#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const runsRoot = resolve(args.runsRoot ?? "benchmark/runs");
const caseFilter = new Set([].concat(args.case ?? []).filter(Boolean));
const dryRun = Boolean(args.dryRun);

const resultPaths = findResultPaths(runsRoot);
let updated = 0;

for (const resultPath of resultPaths) {
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (result.mode !== "agent" || result.invalid_run) continue;
  if (caseFilter.size > 0 && !caseFilter.has(result.case_id)) continue;

  const workspace = resolve(dirname(resultPath), "workspace");
  if (!existsSync(workspace)) continue;
  sanitizeWorkspaceInstructions(workspace);
  const casePath = resolve(result.case_path);
  if (!existsSync(casePath)) continue;

  const caseData = parseSimpleYaml(readFileSync(casePath, "utf8"));
  validateCaseStrategy(caseData);
  const runDir = dirname(resultPath);
  const setupResult = runCommands("regrade-setup", caseData.setup ?? [], workspace, runDir, caseData, {
    appendRepoArg: false,
    network: "bridge",
  });
  const setupPass = setupResult.every((step) => step.exit_code === 0);
  const testResult = setupPass
    ? runTestStrategy(caseData, workspace, runDir)
    : {
        success: false,
        success_rule: "setup_and_tests",
        setup_pass: false,
        core_pass: false,
        regression_pass: false,
        core: [],
        regressions: [],
        metrics: summarizeTestMetrics([], []),
      };
  const previous = {
    success: result.success,
    test_result: result.test_result ?? null,
  };

  result.previous_regrade = previous;
  result.regraded_at = new Date().toISOString();
  result.regrade_reason = args.reason ?? "hidden scoring update";
  result.setup_result = setupResult;
  result.test_result = testResult;
  result.success = testResult.success;
  result.metrics = {
    ...(result.metrics ?? {}),
    tests: testResult.metrics,
  };

  if (!dryRun) {
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  updated += 1;
  console.log(`${dryRun ? "would regrade" : "regraded"} ${result.case_id} ${result.harness}: ${previous.success} -> ${result.success}`);
}

console.log(`${dryRun ? "would update" : "updated"} ${updated} results`);

function findResultPaths(root) {
  const entries = existsSync(root) ? spawnSync("find", [root, "-mindepth", "2", "-maxdepth", "2", "-name", "result.json"], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  }) : { status: 0, stdout: "" };
  if (entries.status !== 0) {
    throw new Error(entries.stderr || "find result.json failed");
  }
  return entries.stdout.split(/\r?\n/).filter(Boolean).map((path) => resolve(path));
}

function runTestStrategy(caseData, repoDir, runDir) {
  const strategy = caseData.test_strategy;

  const core = runCommands("regrade-core", strategy.core_tests ?? [], repoDir, runDir, caseData);
  const regressions = runCommands("regrade-regression", strategy.regression_tests ?? [], repoDir, runDir, caseData);

  const corePass = core.every((test) => test.exit_code === 0);
  const regressionPass = regressions.every((test) => test.exit_code === 0);
  const success = corePass && regressionPass;

  return {
    success,
    success_rule: "core_and_regression",
    core_pass: corePass,
    regression_pass: regressionPass,
    core,
    regressions,
    metrics: summarizeTestMetrics(core, regressions),
  };
}

function validateCaseStrategy(caseData) {
  const strategy = caseData.test_strategy;
  if (!strategy) {
    throw new Error(`${caseData.id ?? "case"} is missing required test_strategy`);
  }
  if (Object.hasOwn(caseData, "hidden_tests")) {
    throw new Error(`${caseData.id ?? "case"} uses removed field hidden_tests`);
  }
  if (Object.hasOwn(strategy, "oracle_suites")) {
    throw new Error(`${caseData.id ?? "case"} uses removed field test_strategy.oracle_suites`);
  }
  const rule = strategy.success_rule ?? "core_and_regression";
  if (rule !== "core_and_regression") {
    throw new Error(`${caseData.id ?? "case"} uses unsupported success_rule ${rule}`);
  }
}

function runCommands(group, commands, repoDir, runDir, caseData, options = {}) {
  return commands.map((command, index) => runTestCommand(group, index, command, repoDir, runDir, caseData, options));
}

function runTestCommand(group, index, command, repoDir, runDir, caseData, options = {}) {
  mkdirSync(runDir, { recursive: true });
  const normalized = String(command);
  const safeGroup = group.replace(/[^A-Za-z0-9_.-]/g, "_");
  const stdoutPath = resolve(runDir, `${safeGroup}-${index}.stdout.log`);
  const stderrPath = resolve(runDir, `${safeGroup}-${index}.stderr.log`);
  const started = new Date();
  const startedMs = Date.now();
  const result = runCommandProcess({ command: normalized, repoDir, runDir, caseData, options });
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

function runCommandProcess({ command, repoDir, runDir, caseData, options }) {
  const environment = caseData.environment ?? {};
  const useContainer = Boolean(environment.image) && environment.tests_in_container !== false;
  const appendRepoArg = options.appendRepoArg ?? true;
  if (!useContainer) {
    const hostCommand = appendRepoArg ? `${shellQuote(command)} ${shellQuote(repoDir)}` : command;
    return spawnSync("bash", ["-lc", hostCommand], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
  }

  const workdir = environment.workdir ?? "/work/repo";
  const benchRoot = process.cwd();
  const cacheDir = resolve(runDir, "container-cache");
  mkdirSync(cacheDir, { recursive: true });
  const translated = translateContainerCommand(command);
  const shellCommand = appendRepoArg ? `${shellQuote(translated)} ${shellQuote(workdir)}` : translated;
  const network = options.network ?? (environment.test_network === "none" ? "none" : "bridge");
  return spawnSync("docker", [
    "run",
    "--rm",
    "--network",
    network,
    "--user",
    `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    "-v",
    `${repoDir}:${workdir}`,
    "-v",
    `${benchRoot}:/work/bench:ro`,
    "-v",
    `${cacheDir}:/work/cache`,
    "-w",
    workdir,
    "-e",
    "HOME=/work/cache/home",
    "-e",
    "XDG_CACHE_HOME=/work/cache/xdg",
    "-e",
    "CARGO_HOME=/work/cache/cargo",
    "-e",
    "GOMODCACHE=/work/cache/go/pkg/mod",
    "-e",
    "GOCACHE=/work/cache/go/build",
    "-e",
    "UV_CACHE_DIR=/work/cache/uv",
    environment.image,
    "bash",
    "-c",
    shellCommand,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
}

function translateContainerCommand(command) {
  return command.replaceAll("benchmark/cases/", "/work/bench/benchmark/cases/");
}

function summarizeTestMetrics(core, regressions) {
  const coreDuration = sumDurations(core);
  const regressionDuration = sumDurations(regressions);
  return {
    total_duration_ms: coreDuration + regressionDuration,
    core_duration_ms: coreDuration,
    regression_duration_ms: regressionDuration,
  };
}

function sumDurations(tests) {
  return tests.reduce((sum, test) => sum + (test.duration_ms ?? 0), 0);
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

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();

    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;

    if (line.startsWith("- ")) {
      if (!Array.isArray(parent)) throw new Error(`unsupported YAML list: ${line}`);
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
      const next = nextMeaningfulLine(lines, index + 1);
      const container = next?.trim().startsWith("- ") ? [] : {};
      parent[key] = container;
      stack.push({ indent, value: container });
    } else if (value === ">") {
      const blockLines = [];
      const blockIndent = nextMeaningfulLine(lines, index + 1)?.match(/^ */)?.[0].length ?? indent + 2;
      index += 1;
      while (index < lines.length) {
        const blockRaw = lines[index];
        if (blockRaw.trim() && blockRaw.match(/^ */)[0].length < blockIndent) {
          index -= 1;
          break;
        }
        blockLines.push(blockRaw.slice(Math.min(blockIndent, blockRaw.length)));
        index += 1;
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
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim() && !lines[index].trim().startsWith("#")) return lines[index];
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
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    const value = !next || next.startsWith("--") ? true : next;
    if (parsed[key] == null) {
      parsed[key] = value;
    } else {
      parsed[key] = [].concat(parsed[key], value);
    }
    if (value !== true) index += 1;
  }
  return parsed;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
