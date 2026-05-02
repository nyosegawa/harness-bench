#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const runsRoot = resolve(process.argv[2] ?? "benchmark/runs");
const output = resolve(process.argv[3] ?? "benchmark/reports/results.html");

const results = loadResults(runsRoot);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, renderHtml(results));
console.log(output);

function loadResults(root) {
  const stdin = readFileSync("/dev/stdin", "utf8").trim();
  const list = stdin
    ? (stdin.startsWith("[") ? JSON.parse(stdin) : stdin.split(/\r?\n/).filter(Boolean))
    : [];
  return list
    .map((path) => resolve(path, "result.json"))
    .filter((path) => existsSync(path))
    .map((path) => {
      const result = JSON.parse(readFileSync(path, "utf8"));
      return normalizeResultForDisplay({ ...result, result_path: path });
    })
    .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
}

function renderHtml(results) {
  const agentResults = results.filter((result) => result.mode === "agent" && !result.invalid_run);
  const invalidResults = results.filter((result) => result.mode === "agent" && result.invalid_run);
  const summary = summarize(agentResults);
  const caseSummaryRows = renderSummaryRows(groupSummary(agentResults, (result) => result.case_id));
  const harnessSummaryRows = renderSummaryRows(groupSummary(agentResults, (result) => result.harness));
  const difficultySummaryRows = renderSummaryRows(groupSummary(agentResults, (result) => caseMeta(result).difficulty ?? "unknown"));
  const sizeSummaryRows = renderSummaryRows(groupSummary(agentResults, (result) => caseMeta(result).size_bucket ?? "unknown"));
  const invalidRows = invalidResults.map((result) => `
      <tr>
        <td>${esc(result.case_id)}</td>
        <td>${esc(result.harness ?? "")}</td>
        <td>${esc(result.condition_id ?? "")}</td>
        <td>${esc(result.invalid_reason ?? "")}</td>
        <td><code>${esc(result.run_id)}</code></td>
      </tr>
    `).join("\n");
  const rows = agentResults.map((result) => {
    const metrics = result.metrics ?? {};
    const harnessMetrics = metrics.harness ?? {};
    const usage = metrics.usage ?? {};
    const effort = result.effort ?? inferEffort(result.model, harnessMetrics.model);
    const cost = formatCost(usage);
    const meta = caseMeta(result);
    return `
      <tr data-case="${escAttr(result.case_id)}" data-harness="${escAttr(result.harness ?? "")}" data-result="${result.success ? "pass" : "fail"}">
        <td>${esc(result.case_id)}</td>
        <td>${esc(meta.difficulty ?? "")}</td>
        <td>${esc(meta.size_bucket ?? "")}</td>
        <td>${esc(result.harness ?? "")}</td>
        <td>${esc(result.condition_id ?? "")}</td>
        <td>${esc(result.model ?? harnessMetrics.model ?? "")}</td>
        <td>${esc(effort)}</td>
        <td class="${result.success ? "pass" : "fail"}">${result.success ? "pass" : "fail"}</td>
        <td>${fmtMs(metrics.wall_time_ms)}</td>
        <td>${fmtMs(harnessMetrics.harness_duration_ms)}</td>
        <td>${fmtMs(metrics.tests?.total_duration_ms)}</td>
        <td>${fmt(usage.conversation_turns ?? usage.turns)}</td>
        <td>${fmt(usage.assistant_messages)}</td>
        <td>${fmt(usage.tool_calls)}</td>
        <td>${fmt(usage.command_calls)}</td>
        <td>${fmt(usage.file_changes)}</td>
        <td>${fmt(usage.fresh_input_tokens ?? usage.input_tokens)}</td>
        <td>${fmt(usage.cache_read_tokens)}</td>
        <td>${fmt(usage.cache_write_tokens)}</td>
        <td>${fmt(usage.effective_input_tokens ?? usage.input_tokens)}</td>
        <td>${fmt(usage.output_tokens)}</td>
        <td>${fmt(usage.reasoning_tokens)}</td>
        <td>${fmt(usage.effective_total_tokens ?? usage.total_tokens)}</td>
        <td>${cost.value}</td>
        <td>${esc(usage.cost_source ?? "")}</td>
        <td><code>${esc(result.run_id)}</code></td>
      </tr>
    `;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Harness Benchmark Results</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f7f4; color: #202124; }
    header { padding: 28px 32px 18px; background: #ffffff; border-bottom: 1px solid #ddddda; }
    h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: 0; }
    p { margin: 0; color: #5f6368; }
    main { padding: 24px 32px 40px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .metric { background: #ffffff; border: 1px solid #dededb; border-radius: 8px; padding: 14px; }
    .metric .label { font-size: 12px; color: #6b6f76; margin-bottom: 6px; }
    .metric .value { font-size: 22px; font-weight: 650; }
    .table-wrap { overflow-x: auto; background: #ffffff; border: 1px solid #dededb; border-radius: 8px; }
    .controls { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 16px; align-items: end; }
    label { display: grid; gap: 4px; font-size: 12px; color: #5f6368; }
    select { min-width: 150px; border: 1px solid #c9c9c5; border-radius: 6px; background: #fff; padding: 7px 8px; font: inherit; }
    .summaries { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin: 0 0 18px; }
    .summary-table { overflow-x: auto; background: #ffffff; border: 1px solid #dededb; border-radius: 8px; }
    h2 { font-size: 15px; margin: 0; padding: 12px 12px 0; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #ededeb; text-align: left; white-space: nowrap; }
    th { position: sticky; top: 0; background: #fafaf8; color: #4b4f56; font-weight: 650; }
    tr:last-child td { border-bottom: 0; }
    .pass { color: #137333; font-weight: 700; }
    .fail { color: #b3261e; font-weight: 700; }
    .muted { color: #6b6f76; }
    .section { margin-top: 18px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>Harness Benchmark Results</h1>
    <p>Generated at ${esc(new Date().toISOString())}</p>
  </header>
  <main>
    <section class="summary">
      <div class="metric"><div class="label">Agent Runs</div><div class="value">${summary.count}</div></div>
      <div class="metric"><div class="label">Pass Rate</div><div class="value">${summary.passRate}</div></div>
      <div class="metric"><div class="label">Median Wall Time</div><div class="value">${fmtMs(summary.medianWallMs)}</div></div>
      <div class="metric"><div class="label">Invalid Runs</div><div class="value">${invalidResults.length}</div></div>
      <div class="metric"><div class="label">Reported Cost</div><div class="value">${summary.reportedCost == null ? "n/a" : `$${summary.reportedCost.toFixed(4)}`}</div></div>
      <div class="metric"><div class="label">Estimated Cost</div><div class="value">${summary.estimatedCost == null ? "n/a" : `$${summary.estimatedCost.toFixed(4)}`}</div></div>
    </section>
    <section class="summaries">
      ${renderSummaryTable("By Case", caseSummaryRows)}
      ${renderSummaryTable("By Harness", harnessSummaryRows)}
      ${renderSummaryTable("By Difficulty", difficultySummaryRows)}
      ${renderSummaryTable("By Repo Size", sizeSummaryRows)}
    </section>
    <section class="controls">
      ${renderSelect("case-filter", "Case", ["", ...unique(agentResults.map((result) => result.case_id))])}
      ${renderSelect("harness-filter", "Harness", ["", ...unique(agentResults.map((result) => result.harness))])}
      ${renderSelect("result-filter", "Result", ["", "pass", "fail"])}
    </section>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Case</th><th>Difficulty</th><th>Size</th><th>Harness</th><th>Condition</th><th>Model</th><th>Effort</th><th>Result</th>
            <th>Wall</th><th>Harness</th><th>Tests</th><th>Conv Turns</th><th>Assistant</th><th>Tools</th>
            <th>Commands</th><th>File Edits</th><th>Fresh Input</th><th>Cache Read</th><th>Cache Write</th><th>Effective Input</th>
            <th>Output</th><th>Reasoning</th><th>Effective Total</th>
            <th>Cost</th><th>Cost Source</th><th>Run</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <section class="section">
      <h2>Invalid Runs</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Case</th><th>Harness</th><th>Condition</th><th>Reason</th><th>Run</th></tr></thead>
          <tbody>${invalidRows || `<tr><td colspan="5" class="muted">No invalid runs</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  </main>
  <script>
    const filters = {
      case: document.getElementById("case-filter"),
      harness: document.getElementById("harness-filter"),
      result: document.getElementById("result-filter")
    };
    for (const filter of Object.values(filters)) filter.addEventListener("change", applyFilters);
    function applyFilters() {
      for (const row of document.querySelectorAll("tbody tr[data-case]")) {
        const visible = (!filters.case.value || row.dataset.case === filters.case.value)
          && (!filters.harness.value || row.dataset.harness === filters.harness.value)
          && (!filters.result.value || row.dataset.result === filters.result.value);
        row.hidden = !visible;
      }
    }
  </script>
</body>
</html>`;
}

function normalizeResultForDisplay(result) {
  if (result.mode !== "agent") return result;
  const runDir = dirname(result.result_path);
  const metrics = result.metrics ?? {};
  const harnessMetrics = metrics.harness ?? {};
  let usage = { ...(metrics.usage ?? {}) };

  if (result.harness === "codex") {
    const events = readJsonl(resolve(runDir, "harness.events.jsonl"));
    if (events.length > 0) {
      usage = normalizeCodexUsage(events, usage);
      result.metrics = {
        ...metrics,
        harness: { ...harnessMetrics, model: harnessMetrics.model ?? result.model ?? null },
        usage,
      };
    }
  } else if (result.harness === "cursor") {
    const events = readJsonl(resolve(runDir, "harness.events.jsonl"));
    if (events.length > 0) {
      const normalized = normalizeCursorUsage(events, usage);
      usage = normalized.usage;
      result.metrics = {
        ...metrics,
        harness: { ...harnessMetrics, model: harnessMetrics.model ?? normalized.model ?? null },
        usage,
      };
    }
  } else if (result.harness === "claude") {
    const raw = readJsonFile(resolve(runDir, "harness.result.json"));
    if (raw) {
      usage = normalizeClaudeUsage(raw, usage);
      result.metrics = {
        ...metrics,
        harness: { ...harnessMetrics, model: result.model ?? harnessMetrics.model ?? dominantClaudeModel(raw.modelUsage) ?? null },
        usage,
      };
    }
  }

  result.metrics = result.metrics ?? metrics;
  result.metrics.usage = normalizeDerivedUsage(result.metrics.usage ?? usage);
  return result;
}

function normalizeCodexUsage(events, previous) {
  const turnCompleted = events.filter((event) => event.type === "turn.completed");
  const rawUsage = turnCompleted.at(-1)?.usage ?? previous.raw_usage ?? {};
  const completedItems = events.filter((event) => event.type === "item.completed");
  const commandCalls = completedItems.filter((event) => event.item?.type === "command_execution").length;
  const fileChanges = completedItems.filter((event) => event.item?.type === "file_change").length;
  const usage = {
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
  };
  return normalizeDerivedUsage(usage, { codexInputIncludesCache: true });
}

function normalizeClaudeUsage(raw, previous) {
  const rawUsage = raw.usage ?? previous.raw_usage?.usage ?? {};
  return normalizeDerivedUsage({
    ...previous,
    conversation_turns: raw.num_turns ?? previous.conversation_turns ?? previous.turns ?? null,
    turns: raw.num_turns ?? previous.turns ?? null,
    assistant_messages: raw.num_turns ?? previous.assistant_messages ?? null,
    input_tokens: rawUsage.input_tokens ?? previous.input_tokens ?? null,
    output_tokens: rawUsage.output_tokens ?? previous.output_tokens ?? null,
    reasoning_tokens: previous.reasoning_tokens ?? null,
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
  const rawUsage = result.usage ?? previous.raw_usage ?? {};
  const assistantMessages = events.filter((event) => event.type === "assistant").length;
  const usage = normalizeDerivedUsage({
    ...previous,
    conversation_turns: assistantMessages,
    turns: assistantMessages,
    assistant_messages: assistantMessages,
    tool_calls: events.filter((event) => event.type === "tool_call" && event.subtype === "completed").length,
    input_tokens: rawUsage.inputTokens ?? previous.input_tokens ?? null,
    output_tokens: rawUsage.outputTokens ?? previous.output_tokens ?? null,
    reasoning_tokens: previous.reasoning_tokens ?? null,
    cache_read_tokens: rawUsage.cacheReadTokens ?? previous.cache_read_tokens ?? null,
    cache_write_tokens: rawUsage.cacheWriteTokens ?? previous.cache_write_tokens ?? null,
    raw_usage: rawUsage,
  });
  return { model: init?.model ?? null, usage };
}

function normalizeDerivedUsage(usage, options = {}) {
  const input = numericOrNull(usage.input_tokens);
  const cacheRead = numericOrNull(usage.cache_read_tokens);
  const cacheWrite = numericOrNull(usage.cache_write_tokens);
  const output = numericOrNull(usage.output_tokens);
  const freshInput = numericOrNull(usage.fresh_input_tokens) ??
    (options.codexInputIncludesCache ? subtractNullable(input, cacheRead) : input);
  const effectiveInput = numericOrNull(usage.effective_input_tokens) ??
    (options.codexInputIncludesCache ? input : sumNullable(freshInput, cacheRead, cacheWrite));
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

function summarize(results) {
  const count = results.length;
  const passed = results.filter((result) => result.success).length;
  const wall = results.map((result) => result.metrics?.wall_time_ms).filter((value) => typeof value === "number").sort((a, b) => a - b);
  const reportedCosts = costsBySource(results, "reported");
  const estimatedCosts = costsBySource(results, "estimated");
  return {
    count,
    passRate: count ? `${Math.round((passed / count) * 100)}%` : "n/a",
    medianWallMs: wall.length ? wall[Math.floor(wall.length / 2)] : null,
    reportedCost: reportedCosts.length ? reportedCosts.reduce((sum, value) => sum + value, 0) : null,
    estimatedCost: estimatedCosts.length ? estimatedCosts.reduce((sum, value) => sum + value, 0) : null,
  };
}

function groupSummary(results, keyFn) {
  const groups = new Map();
  for (const result of results) {
    const key = keyFn(result) ?? "unknown";
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([key, group]) => {
      const passed = group.filter((result) => result.success).length;
      const wall = median(group.map((result) => result.metrics?.wall_time_ms).filter((value) => typeof value === "number"));
      const reported = costsBySource(group, "reported");
      const estimated = costsBySource(group, "estimated");
      return {
        key,
        count: group.length,
        passed,
        passRate: group.length ? `${Math.round((passed / group.length) * 100)}%` : "n/a",
        medianWallMs: wall,
        reportedCost: reported.length ? reported.reduce((sum, value) => sum + value, 0) : null,
        estimatedCost: estimated.length ? estimated.reduce((sum, value) => sum + value, 0) : null,
      };
    });
}

function renderSummaryTable(title, rows) {
  return `
      <div class="summary-table">
        <h2>${esc(title)}</h2>
        <table>
          <thead><tr><th>Name</th><th>Runs</th><th>Pass</th><th>Rate</th><th>Median Wall</th><th>Reported $</th><th>Estimated $</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="muted">No runs</td></tr>`}</tbody>
        </table>
      </div>
    `;
}

function renderSummaryRows(rows) {
  return rows.map((row) => `
    <tr>
      <td>${esc(row.key)}</td>
      <td>${fmt(row.count)}</td>
      <td>${fmt(row.passed)}</td>
      <td>${esc(row.passRate)}</td>
      <td>${fmtMs(row.medianWallMs)}</td>
      <td>${row.reportedCost == null ? "" : `$${row.reportedCost.toFixed(4)}`}</td>
      <td>${row.estimatedCost == null ? "" : `$${row.estimatedCost.toFixed(4)}`}</td>
    </tr>
  `).join("\n");
}

function renderSelect(id, label, values) {
  return `
    <label>${esc(label)}
      <select id="${escAttr(id)}">
        ${values.map((value) => `<option value="${escAttr(value ?? "")}">${esc(value || "All")}</option>`).join("\n")}
      </select>
    </label>
  `;
}

function costsBySource(results, source) {
  return results
    .map((result) => result.metrics?.usage)
    .filter((usage) => usage?.cost_source === source && typeof usage.cost_usd === "number")
    .map((usage) => usage.cost_usd);
}

function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function caseMeta(result) {
  return result.case_metadata ?? {};
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

function inferEffort(...values) {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (/\bxhigh\b|extra[- ]?high/.test(text)) return "xhigh";
  if (/\bhigh\b/.test(text)) return "high";
  if (/\bmedium\b|\bmed\b/.test(text)) return "medium";
  if (/\blow\b/.test(text)) return "low";
  if (/\bminimal\b/.test(text)) return "minimal";
  return "";
}

function formatCost(usage) {
  if (usage.cost_usd == null) return { value: "" };
  return { value: `$${usage.cost_usd.toFixed(6)}` };
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

function fmt(value) {
  if (value == null) return "";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

function fmtMs(value) {
  if (value == null) return "";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escAttr(value) {
  return esc(value).replaceAll("'", "&#39;");
}
