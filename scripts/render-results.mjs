#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const runsRoot = resolve(required(args.runsRoot, "--runsRoot is required"));
const output = resolve(required(args.output, "--output is required"));
const matrixIdFilter = args.matrixId ?? null;
const reviewFile = resolve(required(args.reviewFile, "--reviewFile is required"));
const caseMetadataCache = new Map();
const failureReviews = loadFailureReviews(reviewFile);

const results = loadResults(runsRoot);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${renderHtml(results).replace(/[ \t]+$/gm, "")}\n`);
console.log(output);

function loadResults(root) {
  const stdin = readFileSync("/dev/stdin", "utf8").trim();
  const list = stdin
    ? (stdin.startsWith("[") ? JSON.parse(stdin) : stdin.split(/\r?\n/).filter(Boolean))
    : findRunDirs(root);
  return list
    .map((path) => resolve(path, "result.json"))
    .filter((path) => existsSync(path))
    .map((path) => {
      const result = JSON.parse(readFileSync(path, "utf8"));
      return normalizeResultForDisplay({ ...result, result_path: path });
    })
    .filter((result) => !matrixIdFilter || result.matrix_id === matrixIdFilter)
    .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
}

function findRunDirs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(root, entry.name))
    .filter((path) => existsSync(resolve(path, "result.json")));
}

function renderHtml(results) {
  const agentResults = results.filter((result) => result.mode === "agent" && !result.invalid_run);
  const invalidResults = results.filter((result) => result.mode === "agent" && result.invalid_run);
  const views = buildViews(agentResults);
  const summary = summarize(views.baseline);
  const harnessSummaryRows = renderSummaryRows(groupSummary(views.baseline, (result) => result.harness));
  const conditionCards = renderConditionCards(conditionSummary(views.baseline));
  const charts = renderCharts(views.baseline);
  const matrixGrid = renderMatrixGrid(views.baseline);
  const caseCatalog = renderCaseCatalog(views.baseline);
  const executiveSummary = buildExecutiveSummary(views.baseline);
  const falseNegativeRows = renderFalseNegativeRows(falseNegativeSummary(views.baseline));
  const failureReviewRows = renderFailureReviewRows(views.baseline);
  const difficultySummaryRows = renderSummaryRows(groupSummary(views.baseline, (result) => caseMeta(result).difficulty ?? "unknown"));
  const sizeSummaryRows = renderSummaryRows(groupSummary(views.baseline, (result) => caseMeta(result).size_bucket ?? "unknown"));
  const failureSummaryRows = renderFailureSummaryRows(failureSummary(views.baseline.filter((result) => !result.success)));
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
    const failure = classifyFailure(result);
    const view = runView(result);
    const condition = displayCondition(result);
    return `
      <tr data-view="${escAttr(view)}" data-case="${escAttr(result.case_id)}" data-harness="${escAttr(result.harness ?? "")}" data-result="${result.success ? "pass" : "fail"}"${view === "baseline" ? "" : " hidden"}>
        <td>${esc(result.case_id)}</td>
        <td>${badge(meta.difficulty ?? "")}</td>
        <td>${badge(meta.size_bucket ?? "")}</td>
        <td>${badge(result.harness ?? "")}</td>
        <td>${badge(condition)}</td>
        <td>${esc(result.model ?? harnessMetrics.model ?? "")}</td>
        <td>${esc(effort)}</td>
        <td>${badge(result.success ? "pass" : "fail", result.success ? "pass-badge" : "fail-badge", result.success ? "passValue" : "failValue")}</td>
        <td>${failure.category ? badge(failure.category, "failure-badge", failureCategoryKey(failure.category)) : ""}</td>
        <td class="evidence">${esc(failure.detail)}</td>
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
  <title>HarnessBench Results</title>
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
    .summary-table table { table-layout: fixed; }
    .summary-table th, .summary-table td { white-space: normal; padding: 8px 9px; }
    .condition-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin: 0 0 18px; }
    .condition-card { background: #ffffff; border: 1px solid #dededb; border-radius: 8px; padding: 14px; display: grid; gap: 10px; }
    .condition-card h2 { padding: 0; font-size: 14px; }
    .condition-main { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .condition-rate { font-size: 28px; font-weight: 750; }
    .condition-meta { color: #5f6368; font-size: 12px; }
    .condition-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12px; }
    .condition-stats div { background: #f7f7f4; border-radius: 6px; padding: 8px; }
    .condition-stats strong { display: block; font-size: 14px; color: #202124; margin-top: 2px; }
    .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; margin: 0 0 18px; }
    .chart-card { background: #ffffff; border: 1px solid #dededb; border-radius: 8px; padding: 14px; }
    .chart-card h2 { padding: 0; margin: 0 0 10px; }
    .bar-row { display: grid; grid-template-columns: minmax(86px, 0.7fr) minmax(150px, 1.8fr) minmax(58px, 0.5fr); gap: 10px; align-items: center; margin: 8px 0; }
    .bar-label { font-size: 12px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { height: 12px; background: #ecedea; border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; background: #2f6f9f; border-radius: 999px; }
    .bar-fill.secondary { background: #6f7f45; }
    .bar-fill.cost { background: #936a2f; }
    .bar-value { font-size: 12px; color: #3f4248; text-align: right; white-space: nowrap; }
    .stack-row { display: grid; grid-template-columns: minmax(78px, 0.6fr) 1fr; gap: 10px; align-items: center; margin: 8px 0; }
    .stack-track { display: grid; grid-template-columns: repeat(3, 1fr); height: 22px; border-radius: 6px; overflow: hidden; border: 1px solid #dededb; }
    .stack-seg { display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 700; }
    .stack-low { background: #577b9d; }
    .stack-mid { background: #668650; }
    .stack-high { background: #9d6d44; }
    .matrix-panel { background: #ffffff; border: 1px solid #dededb; border-radius: 8px; margin: 0 0 18px; overflow: hidden; }
    .report-section { background: #ffffff; border: 1px solid #dededb; border-radius: 8px; margin: 0 0 18px; padding: 14px; }
    .report-section h2 { padding: 0 0 8px; }
    .report-section p, .section-copy { white-space: normal; line-height: 1.55; color: #3f4248; margin: 0 12px 12px; }
    .matrix-grid { display: grid; grid-template-columns: minmax(220px, 1.7fr) repeat(var(--condition-count), minmax(92px, 0.7fr)); }
    .matrix-cell { padding: 8px 10px; border-bottom: 1px solid #ededeb; border-right: 1px solid #ededeb; min-width: 0; }
    .matrix-head { background: #fafaf8; font-weight: 650; color: #4b4f56; }
    .case-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .case-sub { color: #6b6f76; font-size: 11px; margin-top: 2px; }
    .result-dot { display: inline-flex; align-items: center; justify-content: center; min-width: 54px; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-weight: 750; }
    .result-pass { background: #e7f4ea; color: #137333; }
    .result-fail { background: #fce8e6; color: #b3261e; }
    .detail-toggle { border: 1px solid #c9c9c5; border-radius: 6px; background: #fff; padding: 7px 10px; font: inherit; cursor: pointer; margin: 0 0 12px; }
    .detail-table-section[hidden] { display: none; }
    .compact-list { display: grid; gap: 8px; padding: 0 12px 12px; }
    .review-row { display: grid; grid-template-columns: minmax(220px, 1.2fr) minmax(90px, 0.4fr) minmax(260px, 1.6fr); gap: 10px; align-items: start; border-top: 1px solid #ededeb; padding-top: 8px; }
    .failure-review-list { display: grid; gap: 10px; padding: 0 12px 12px; }
    .failure-review-card { border-top: 1px solid #ededeb; padding-top: 10px; display: grid; gap: 6px; }
    .failure-review-card h3 { margin: 0; font-size: 13px; }
    .failure-review-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .failure-review-card p { margin: 0; white-space: normal; line-height: 1.45; color: #3f4248; }
    .case-catalog { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 10px; padding: 0 12px 12px; }
    .case-card { border-top: 1px solid #ededeb; padding-top: 10px; }
    .case-card h3 { margin: 0 0 6px; font-size: 13px; }
    .case-card p { margin: 6px 0 0; white-space: normal; line-height: 1.4; color: #3f4248; }
    h2 { font-size: 15px; margin: 0; padding: 12px 12px 0; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #ededeb; text-align: left; white-space: nowrap; }
    th { position: sticky; top: 0; background: #fafaf8; color: #4b4f56; font-weight: 650; }
    tr:last-child td { border-bottom: 0; }
    .pass { color: #137333; font-weight: 700; }
    .fail { color: #b3261e; font-weight: 700; }
    .badge { display: inline-block; max-width: 260px; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; border: 1px solid #d8d9d5; border-radius: 999px; padding: 2px 8px; background: #f5f6f3; color: #34373d; font-size: 12px; }
    .pass-badge { background: #e7f4ea; border-color: #b8dfc2; color: #137333; font-weight: 700; }
    .fail-badge { background: #fce8e6; border-color: #f2b8b5; color: #b3261e; font-weight: 700; }
    .failure-badge { background: #fff4d6; border-color: #f2d184; color: #5f4600; }
    .evidence { max-width: 420px; white-space: normal; line-height: 1.35; color: #3f4248; }
    .muted { color: #6b6f76; }
    .note { margin: -6px 0 14px; font-size: 12px; color: #6b6f76; }
    .section { margin-top: 18px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1 data-i18n="reportTitle">HarnessBench Results</h1>
    <p>Generated at ${esc(new Date().toISOString())}</p>
  </header>
  <main>
    <section class="controls">
      ${renderSelect("language-filter", "Language", ["en", "ja"], "language")}
      ${renderSelect("view-filter", "View", ["baseline", "all", "pilot-smoke"], "view")}
      ${renderSelect("case-filter", "Case", ["", ...unique(agentResults.map((result) => result.case_id))], "case")}
      ${renderSelect("harness-filter", "Harness", ["", ...unique(agentResults.map((result) => result.harness))], "harness")}
      ${renderSelect("result-filter", "Result", ["", "pass", "fail"], "result")}
    </section>
    <p class="note" data-i18n="viewNote">Default view shows official matrix runs. Exploratory and smoke runs are available from the View filter.</p>
    <section class="summary">
      <div class="metric"><div class="label" data-i18n="baselineRuns">Official Runs</div><div class="value">${summary.count}</div></div>
      <div class="metric"><div class="label" data-i18n="passRate">Pass Rate</div><div class="value">${summary.passRate}</div></div>
      <div class="metric"><div class="label" data-i18n="medianWall">Median Wall Time</div><div class="value">${fmtMs(summary.medianWallMs)}</div></div>
      <div class="metric"><div class="label" data-i18n="invalidRuns">Invalid Runs</div><div class="value">${invalidResults.length}</div></div>
      <div class="metric"><div class="label" data-i18n="reportedCost">Reported Cost</div><div class="value">${summary.reportedCost == null ? "n/a" : `$${summary.reportedCost.toFixed(4)}`}</div></div>
      <div class="metric"><div class="label" data-i18n="estimatedCost">Estimated Cost</div><div class="value">${summary.estimatedCost == null ? "n/a" : `$${summary.estimatedCost.toFixed(4)}`}</div></div>
    </section>
    <section class="summaries">
      ${renderSummaryTable("By Harness", "byHarness", harnessSummaryRows)}
      ${renderSummaryTable("By Difficulty", "byDifficulty", difficultySummaryRows)}
      ${renderSummaryTable("By Repo Size", "byRepoSize", sizeSummaryRows)}
      ${renderFailureSummaryTable("By Failure", "byFailure", failureSummaryRows)}
    </section>
    <section>
      <h2 data-i18n="conditionComparison">Harness x Model Comparison</h2>
      <div class="condition-grid">${conditionCards}</div>
    </section>
    <section class="chart-grid">${charts}</section>
    <section class="report-section">
      <h2 data-i18n="executiveSummary">Executive Summary</h2>
      <p data-i18n="executiveSummaryBody">${esc(executiveSummary.en)}</p>
      <p data-i18n="executiveCaveatBody">The headline score is a hidden-test pass rate. Failed runs still need false-negative review before the matrix is used as a final leaderboard.</p>
      <p data-i18n="sanitizationCaveatBody">Sanitization caveat: this recorded run removed repository-local steering files from the working tree before agents started, but it did not yet materialize a fresh git root. A sufficiently curious agent could still have recovered tracked steering files from git objects. Future runs use a fresh one-commit sanitized workspace.</p>
    </section>
    <section class="report-section">
      <h2 data-i18n="frameworkExplanation">Benchmark Design</h2>
      <p data-i18n="frameworkBody">Each case starts from a real repository base commit where hidden scoring fails, and a fixed commit where hidden scoring passes. Agent runs receive only the issue-style instruction and work inside an isolated checkout. A run is counted as pass only when both hidden core and regression tests pass after the agent edit. Raw harness logs are kept locally, metrics are normalized per harness, and invalid infrastructure runs are excluded from official summaries.</p>
      <p data-i18n="caseDesignBody">The case set spans 9 repositories with low, mid, and high difficulty tasks per repository. Difficulty is based on expected debugging complexity, not just repository size. Repo size is tracked separately because a large repository can still have a localized bug, while a small repository can require subtle behavior reconstruction.</p>
      <p data-i18n="metricDesignBody">Turns, tokens, tool calls, and cost are intentionally not collapsed into one ambiguous number. Codex turns mean completed harness invocations, Claude turns and cost come from Claude CLI output, and Cursor usage is normalized from stream events. Cached input is separated from fresh input where the harness exposes it; Codex and Cursor dollar values are API-equivalent estimates, while Claude cost is reported by the harness.</p>
    </section>
    <section class="matrix-panel">
      <h2 data-i18n="caseMatrix">Case Result Matrix</h2>
      ${matrixGrid}
    </section>
    <section class="matrix-panel">
      <h2 data-i18n="falseNegativeReview">False-negative Review</h2>
      <p class="section-copy" data-i18n="falseNegativeBody">Failed baseline runs were checked against hidden-test output and saved workspaces. Hidden-test fixes are applied by regrading preserved workspaces instead of rerunning agents when possible. Remaining failures are reviewed as true implementation failures, core false negatives, regression false negatives, case-design issues, or infrastructure failures.</p>
      <div class="compact-list">${falseNegativeRows}</div>
    </section>
    <section class="matrix-panel">
      <h2 data-i18n="failureReview">Failure Implementation Review</h2>
      <p class="section-copy" data-i18n="failureReviewBody">These notes summarize how the failed implementations went wrong. They are auxiliary analysis generated from hidden-test output, workspace diffs, and saved harness logs where useful; they do not replace hidden-test pass/fail scoring.</p>
      <div class="failure-review-list">${failureReviewRows}</div>
    </section>
    <section class="matrix-panel">
      <h2 data-i18n="caseCatalog">Case Catalog</h2>
      <div class="case-catalog">${caseCatalog}</div>
    </section>
    <button class="detail-toggle" id="detail-toggle" type="button" data-i18n="showDetails">Show Detailed Table</button>
    <div class="table-wrap detail-table-section" id="detail-section" hidden>
      <table>
        <thead>
          <tr>
            <th data-i18n="case">Case</th><th data-i18n="difficulty">Difficulty</th><th data-i18n="size">Size</th><th data-i18n="harness">Harness</th><th data-i18n="condition">Condition</th><th data-i18n="model">Model</th><th data-i18n="effort">Effort</th><th data-i18n="result">Result</th>
            <th data-i18n="failure">Failure</th><th data-i18n="evidence">Evidence</th><th data-i18n="wall">Wall</th><th data-i18n="harnessTime">Harness</th><th data-i18n="tests">Tests</th><th data-i18n="convTurns">Conv Turns</th><th data-i18n="assistant">Assistant</th><th data-i18n="tools">Tools</th>
            <th data-i18n="commands">Commands</th><th data-i18n="fileEdits">File Edits</th><th data-i18n="freshInput">Fresh Input</th><th data-i18n="cacheRead">Cache Read</th><th data-i18n="cacheWrite">Cache Write</th><th data-i18n="effectiveInput">Effective Input</th>
            <th data-i18n="output">Output</th><th data-i18n="reasoning">Reasoning</th><th data-i18n="effectiveTotal">Effective Total</th>
            <th data-i18n="cost">Cost</th><th data-i18n="costSource">Cost Source</th><th data-i18n="run">Run</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <section class="section">
      <h2 data-i18n="invalidRuns">Invalid Runs</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th data-i18n="case">Case</th><th data-i18n="harness">Harness</th><th data-i18n="condition">Condition</th><th data-i18n="reason">Reason</th><th data-i18n="run">Run</th></tr></thead>
          <tbody>${invalidRows || `<tr><td colspan="5" class="muted" data-i18n="noInvalidRuns">No invalid runs</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  </main>
  <script>
    const translations = {
      en: {
        reportTitle: "HarnessBench Results",
        baselineRuns: "Official Runs", passRate: "Pass Rate", medianWall: "Median Wall Time", invalidRuns: "Invalid Runs",
        reportedCost: "Reported Cost", estimatedCost: "Estimated Cost", byCase: "By Case", byHarness: "By Harness",
        byDifficulty: "By Difficulty", byRepoSize: "By Repo Size", byFailure: "By Failure", language: "Language",
        view: "View", case: "Case", harness: "Harness", result: "Result", difficulty: "Difficulty", size: "Size",
        condition: "Condition", model: "Model", effort: "Effort", failure: "Failure", evidence: "Evidence",
        wall: "Wall", harnessTime: "Harness", tests: "Tests", convTurns: "Harness Turns", assistant: "Assistant/Steps",
        tools: "Observable Tools", commands: "Shell Commands", fileEdits: "File Edit Events", freshInput: "Fresh Input", cacheRead: "Cache Read",
        cacheWrite: "Cache Write", effectiveInput: "Effective Input", output: "Output", reasoning: "Reasoning",
        effectiveTotal: "Effective Total", cost: "Cost", costSource: "Cost Source", run: "Run", reason: "Reason",
        name: "Name", runs: "Runs", pass: "Pass", rate: "Rate", medianWallShort: "Median Wall",
        reportedDollar: "Reported $", estimatedDollar: "Estimated $", conditionComparison: "Harness x Model Comparison",
        executiveSummary: "Executive Summary", executiveSummaryBody: ${JSON.stringify(executiveSummary.en)},
        executiveCaveatBody: "The headline score is a hidden-test pass rate. Failed runs still need false-negative review before the matrix is used as a final leaderboard.",
        sanitizationCaveatBody: "Sanitization caveat: this recorded run removed repository-local steering files from the working tree before agents started, but it did not yet materialize a fresh git root. A sufficiently curious agent could still have recovered tracked steering files from git objects. Future runs use a fresh one-commit sanitized workspace.",
        caseMatrix: "Case Result Matrix", showDetails: "Show Detailed Table", hideDetails: "Hide Detailed Table",
        viewNote: "Default view shows official matrix runs. Exploratory and smoke runs are available from the View filter.",
        frameworkExplanation: "Benchmark Design", frameworkBody: "Each case starts from a real repository base commit where hidden scoring fails, and a fixed commit where hidden scoring passes. Agent runs receive only the issue-style instruction and work inside an isolated checkout. A run is counted as pass only when both hidden core and regression tests pass after the agent edit. Raw harness logs are kept locally, metrics are normalized per harness, and invalid infrastructure runs are excluded from official summaries.",
        caseDesignBody: "The case set spans 9 repositories with low, mid, and high difficulty tasks per repository. Difficulty is based on expected debugging complexity, not just repository size. Repo size is tracked separately because a large repository can still have a localized bug, while a small repository can require subtle behavior reconstruction.",
        metricDesignBody: "Turns, tokens, tool calls, and cost are intentionally not collapsed into one ambiguous number. Turn-like counts are harness-specific: Codex reports completed exec turns, Claude reports num_turns, and Cursor has assistant/action-step events rather than a completed-turn primitive. Cached input is separated from fresh input where the harness exposes it; Codex and Cursor dollar values are API-equivalent estimates, while Claude cost is reported by the harness.",
        falseNegativeReview: "False-negative Review", falseNegativeBody: "Failed baseline runs were checked against hidden-test output and saved workspaces. Hidden-test fixes are applied by regrading preserved workspaces instead of rerunning agents when possible. Remaining failures are reviewed as true implementation failures, core false negatives, regression false negatives, case-design issues, or infrastructure failures.",
        failureReview: "Failure Implementation Review", failureReviewBody: "These notes summarize how the failed implementations went wrong. They are auxiliary analysis generated from hidden-test output, workspace diffs, and saved harness logs where useful; they do not replace hidden-test pass/fail scoring.",
        caseCatalog: "Case Catalog", passRateChart: "Pass Rate", wallTimeChart: "Median Wall Time", costPassChart: "Cost Per Pass", difficultyChart: "Success By Difficulty",
        passValue: "pass", failValue: "fail", noInvalidRuns: "No invalid runs",
        failureLabel: "Failure:", evidenceLabel: "Evidence:", recommendationLabel: "Recommendation:",
        noRuns: "No runs", noFailures: "No failures", allOption: "All", medianWallLabel: "Median wall",
        costPerPassLabel: "Cost/pass", costSourceLabel: "Cost source", passedSuffix: "pass",
        reviewVerdict: "review", unlikelyFalseNegative: "unlikely false negative", costSourceReported: "reported",
        costSourceEstimated: "estimated", costSourceUnavailable: "unavailable", failureHiddenTest: "hidden test failure",
        failureBuildSymbol: "build or symbol failure", failureWrongSurface: "wrong CLI/API surface",
        failureAssertion: "hidden assertion mismatch", optionBaseline: "Baseline", optionAllViews: "All runs",
        optionPilotSmoke: "Pilot/Smoke", optionPass: "pass", optionFail: "fail", optionEn: "English", optionJa: "Japanese"
      },
      ja: {
        reportTitle: "HarnessBench 結果",
        baselineRuns: "公式実行", passRate: "成功率", medianWall: "Wall Time 中央値", invalidRuns: "Invalid 実行",
        reportedCost: "報告 Cost", estimatedCost: "推定 Cost", byCase: "Case 別", byHarness: "Harness 別",
        byDifficulty: "Difficulty 別", byRepoSize: "Repo Size 別", byFailure: "Failure 別", language: "言語",
        view: "表示", case: "Case", harness: "Harness", result: "結果", difficulty: "難度", size: "Size",
        condition: "条件", model: "Model", effort: "Effort", failure: "失敗分類", evidence: "根拠",
        wall: "Wall", harnessTime: "Harness 時間", tests: "Test 時間", convTurns: "Harness Turn", assistant: "Assistant/Step",
        tools: "観測 Tool", commands: "Shell Command", fileEdits: "File Edit Event", freshInput: "Fresh Input", cacheRead: "Cache Read",
        cacheWrite: "Cache Write", effectiveInput: "Effective Input", output: "Output", reasoning: "Reasoning",
        effectiveTotal: "Effective Total", cost: "Cost", costSource: "Cost 種別", run: "Run", reason: "理由",
        name: "名前", runs: "実行数", pass: "成功", rate: "率", medianWallShort: "Wall 中央値",
        reportedDollar: "報告 $", estimatedDollar: "推定 $", conditionComparison: "Harness x Model 比較",
        executiveSummary: "要約", executiveSummaryBody: ${JSON.stringify(executiveSummary.ja)},
        executiveCaveatBody: "この headline score は hidden-test 成功率です。最終 leaderboard として使う前に、失敗 run の false-negative review が必要です。",
        sanitizationCaveatBody: "Sanitization caveat: この記録済み run では、agent 開始前に repository-local steering file を working tree から削除していましたが、fresh git root 化はまだしていませんでした。そのため tracked file は git object から復元可能でした。将来の run では sanitized tree を fresh one-commit workspace として渡します。",
        caseMatrix: "Case 結果 Matrix", showDetails: "詳細表を表示", hideDetails: "詳細表を隠す",
        viewNote: "デフォルトでは公式 matrix run を表示します。探索/Smoke run は表示フィルタから確認できます。",
        frameworkExplanation: "ベンチマーク設計", frameworkBody: "各 case は、hidden scoring が失敗する実リポジトリの base commit と、hidden scoring が成功する fixed commit を持ちます。Agent には issue 形式の instruction だけを渡し、隔離 checkout 内で修正させます。Agent 編集後に hidden core/regression test が両方通った場合だけ pass と数えます。raw harness log はローカルに保持し、metrics は harness ごとの意味を保ったまま正規化し、infra invalid run は公式集計から除外します。",
        caseDesignBody: "case set は 9 リポジトリにまたがり、各リポジトリに low/mid/high の 3 段階の task を置いています。difficulty は単なる repo size ではなく、想定される debug の複雑さで決めています。大規模 repo でも局所的な bug はあり、小規模 repo でも微妙な仕様復元が必要な bug はあるため、repo size は別軸として扱います。",
        metricDesignBody: "turn、token、tool call、cost は harness ごとに意味が違うため、曖昧な単一指標に潰していません。turn 系の値は harness 固有です。Codex は完了した exec turn、Claude は num_turns、Cursor は完了 turn primitive ではなく assistant/action-step event 数です。cache input は fresh input と分け、Codex/Cursor の dollar は API-equivalent 推定、Claude は harness 報告値です。",
        falseNegativeReview: "False-negative Review", falseNegativeBody: "失敗した baseline run は hidden test output と保存済み workspace で照合しました。hidden test 修正は、可能な限り agent を再実行せず保存済み workspace の再採点で反映します。残る失敗は true implementation failure、core false negative、regression false negative、case-design issue、infrastructure failure としてレビューします。",
        failureReview: "失敗実装レビュー", failureReviewBody: "ここでは failed implementation がどう間違えたかを要約します。hidden-test output、workspace diff、必要に応じて保存済み harness log から作る補助分析であり、hidden-test の pass/fail 判定を置き換えるものではありません。",
        caseCatalog: "Case Catalog", passRateChart: "成功率", wallTimeChart: "Wall Time 中央値", costPassChart: "成功あたり Cost", difficultyChart: "Difficulty 別成功数",
        passValue: "成功", failValue: "失敗", noInvalidRuns: "Invalid run はありません",
        failureLabel: "失敗:", evidenceLabel: "根拠:", recommendationLabel: "扱い:",
        noRuns: "実行なし", noFailures: "失敗なし", allOption: "すべて", medianWallLabel: "Wall 中央値",
        costPerPassLabel: "成功あたり Cost", costSourceLabel: "Cost 種別", passedSuffix: "成功",
        reviewVerdict: "要レビュー", unlikelyFalseNegative: "false negative 可能性低",
        costSourceReported: "報告値", costSourceEstimated: "推定値", costSourceUnavailable: "なし",
        failureHiddenTest: "hidden test 失敗", failureBuildSymbol: "build/symbol 失敗",
        failureWrongSurface: "CLI/API surface 不一致", failureAssertion: "hidden assertion 不一致",
        optionBaseline: "Baseline のみ", optionAllViews: "全 run", optionPilotSmoke: "Pilot/Smoke",
        optionPass: "成功", optionFail: "失敗", optionEn: "英語", optionJa: "日本語"
      }
    };
    const falseNegativeNotes = ${JSON.stringify(falseNegativeNoteTranslations(), null, 6)};
    const failureReviews = ${JSON.stringify(failureReviewTranslations(), null, 6)};
    const filters = {
      language: document.getElementById("language-filter"),
      view: document.getElementById("view-filter"),
      case: document.getElementById("case-filter"),
      harness: document.getElementById("harness-filter"),
      result: document.getElementById("result-filter")
    };
    for (const filter of Object.values(filters)) filter.addEventListener("change", () => {
      applyFilters();
      applyLanguage();
    });
    document.getElementById("detail-toggle").addEventListener("click", () => {
      const section = document.getElementById("detail-section");
      section.hidden = !section.hidden;
      document.getElementById("detail-toggle").dataset.open = String(!section.hidden);
      applyLanguage();
    });
    applyLanguage();
    applyFilters();
    function applyFilters() {
      for (const row of document.querySelectorAll("tbody tr[data-case]")) {
        const viewVisible = filters.view.value === "all" || row.dataset.view === filters.view.value;
        const visible = viewVisible
          && (!filters.case.value || row.dataset.case === filters.case.value)
          && (!filters.harness.value || row.dataset.harness === filters.harness.value)
          && (!filters.result.value || row.dataset.result === filters.result.value);
        row.hidden = !visible;
      }
    }
    function applyLanguage() {
      const lang = filters.language.value || "en";
      document.documentElement.lang = lang;
      for (const node of document.querySelectorAll("[data-i18n]")) {
        const key = node.dataset.i18n;
        const effectiveKey = key === "showDetails" && node.dataset.open === "true" ? "hideDetails" : key;
        node.textContent = translations[lang]?.[effectiveKey] || translations.en[effectiveKey] || node.textContent;
      }
      for (const option of document.querySelectorAll("option[data-i18n]")) {
        const key = option.dataset.i18n;
        option.textContent = translations[lang]?.[key] || translations.en[key] || option.textContent;
      }
      for (const node of document.querySelectorAll("[data-note-case]")) {
        node.textContent = falseNegativeNotes[node.dataset.noteCase]?.[lang] || falseNegativeNotes[node.dataset.noteCase]?.en || node.textContent;
      }
      for (const node of document.querySelectorAll("[data-review-field]")) {
        const review = failureReviews[node.dataset.reviewKey];
        const value = review?.[node.dataset.reviewField]?.[lang] || review?.[node.dataset.reviewField]?.en;
        if (value) node.textContent = value;
      }
    }
  </script>
</body>
</html>`;
}

function normalizeResultForDisplay(result) {
  result.case_metadata = completeCaseMetadata(result.case_metadata, result);
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

function completeCaseMetadata(metadata, result) {
  const loaded = loadCaseMetadata(result.case_path);
  const fallbackPath = findCasePathById(result.case_id);
  const fallback = fallbackPath ? loadCaseMetadata(fallbackPath) : {};
  return {
    ...fallback,
    ...loaded,
    ...(metadata ?? {}),
  };
}

function findCasePathById(caseId) {
  if (!caseId) return null;
  const parts = String(caseId).split("-");
  for (let index = parts.length - 1; index >= 2; index -= 1) {
    const repoSlug = parts.slice(0, index).join("__");
    const difficulty = parts[index];
    if (!["low", "mid", "high"].includes(difficulty)) continue;
    const candidate = resolve("benchmark/cases", repoSlug, `${difficulty}.yaml`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
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
  return normalizeDerivedUsage(usage, { codexInputIncludesCache: true, forceDerived: true });
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
  }, { forceDerived: true });
}

function normalizeCursorUsage(events, previous) {
  const init = events.find((event) => event.type === "system" && event.subtype === "init");
  const result = events.findLast((event) => event.type === "result") ?? {};
  const rawUsage = result.usage ?? previous.raw_usage ?? {};
  const assistantMessages = events.filter((event) => event.type === "assistant").length;
  const completedToolCalls = events.filter((event) => event.type === "tool_call" && event.subtype === "completed");
  const usage = normalizeDerivedUsage({
    ...previous,
    conversation_turns: assistantMessages,
    turns: assistantMessages,
    assistant_messages: assistantMessages,
    tool_calls: completedToolCalls.length,
    command_calls: completedToolCalls.filter(isCursorCommandToolCall).length,
    file_changes: completedToolCalls.filter(isCursorFileToolCall).length,
    input_tokens: rawUsage.inputTokens ?? previous.input_tokens ?? null,
    output_tokens: rawUsage.outputTokens ?? previous.output_tokens ?? null,
    reasoning_tokens: previous.reasoning_tokens ?? null,
    cache_read_tokens: rawUsage.cacheReadTokens ?? previous.cache_read_tokens ?? null,
    cache_write_tokens: rawUsage.cacheWriteTokens ?? previous.cache_write_tokens ?? null,
    raw_usage: rawUsage,
  }, { forceDerived: true });
  return { model: init?.model ?? null, usage };
}

function normalizeDerivedUsage(usage, options = {}) {
  const input = numericOrNull(usage.input_tokens);
  const cacheRead = numericOrNull(usage.cache_read_tokens);
  const cacheWrite = numericOrNull(usage.cache_write_tokens);
  const output = numericOrNull(usage.output_tokens);
  const freshInput = (options.forceDerived ? null : numericOrNull(usage.fresh_input_tokens)) ??
    (options.codexInputIncludesCache ? subtractNullable(input, cacheRead) : input);
  const effectiveInput = (options.forceDerived ? null : numericOrNull(usage.effective_input_tokens)) ??
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

function isCursorCommandToolCall(event) {
  return Boolean(event.tool_call?.shellToolCall);
}

function isCursorFileToolCall(event) {
  const toolCall = event.tool_call ?? {};
  return Boolean(toolCall.editToolCall || toolCall.writeToolCall || toolCall.deleteToolCall);
}

function dominantClaudeModel(modelUsage) {
  const entries = Object.entries(modelUsage ?? {});
  if (entries.length === 0) return null;
  return entries.sort((a, b) => (b[1]?.costUSD ?? 0) - (a[1]?.costUSD ?? 0))[0][0];
}

function buildViews(results) {
  return {
    all: results,
    baseline: results.filter((result) => runView(result) === "baseline"),
    "smoke-pilot": results.filter((result) => runView(result) === "smoke-pilot"),
  };
}

function runView(result) {
  return result.matrix_id ? "baseline" : "pilot-smoke";
}

function displayCondition(result) {
  if (result.condition_id) return result.condition_id;
  const effort = result.effort ?? inferEffort(result.model, result.metrics?.harness?.model);
  const parts = [result.harness, result.model ?? result.metrics?.harness?.model, effort, "pilot-smoke"]
    .filter(Boolean);
  return parts.join(":");
}

function classifyFailure(result) {
  if (result.success) return { category: "", detail: "" };
  if (result.invalid_run) {
    return {
      category: "infrastructure invalid",
      detail: truncate(result.invalid_reason ?? "invalid run"),
    };
  }

  const core = result.test_result?.core?.find((entry) => entry.exit_code !== 0 || entry.signal) ??
    result.test_result?.core?.[0] ??
    null;
  if (!core) {
    return { category: "agent or runner failure", detail: "no failing core test recorded" };
  }
  if (core.signal) {
    return { category: "timeout or signal", detail: `core test signal ${core.signal}` };
  }

  const output = `${tailFile(core.stderr_path)}\n${tailFile(core.stdout_path)}`;
  const compact = output.replace(/\s+/g, " ").trim();
  if (!compact) {
    return { category: "hidden test failure", detail: `exit ${core.exit_code}` };
  }
  if (/No space left on device|ENOSPC/i.test(compact)) {
    return { category: "infrastructure failure", detail: "disk exhaustion" };
  }
  if (/timed out|timeout/i.test(compact)) {
    return { category: "timeout", detail: firstMatch(compact, /[^.]*timed? out[^.]*/i) };
  }
  if (/\[build failed\]|undefined:|cannot find (name|module)|not found|compilation failed/i.test(compact)) {
    return { category: "build or symbol failure", detail: truncate(compact) };
  }
  if (/unexpected argument|unknown option|unknown flag|unrecognized option/i.test(compact)) {
    return { category: "wrong CLI/API surface", detail: truncate(compact) };
  }
  if (/AssertionError|assert |expected:|expected .* actual|actual:|toEqual|Should be false|An error is expected/i.test(compact)) {
    return { category: "hidden assertion mismatch", detail: truncate(compact) };
  }
  if (/Traceback|panic:|FAIL\b|Error Trace:/i.test(compact)) {
    return { category: "hidden test failure", detail: truncate(compact) };
  }
  return { category: "hidden test failure", detail: truncate(compact) };
}

function tailFile(path) {
  if (!path || !existsSync(path)) return "";
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.slice(-10).join("\n");
}

function firstMatch(text, pattern) {
  return truncate(text.match(pattern)?.[0] ?? text);
}

function truncate(value, length = 180) {
  const text = String(value ?? "").trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
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

function buildExecutiveSummary(results) {
  const caseCount = unique(results.map((result) => result.case_id)).length;
  const rows = groupSummary(results, (result) => result.harness);
  const ordered = ["codex", "claude", "cursor"]
    .map((name) => rows.find((row) => row.key === name))
    .filter(Boolean);
  const scoreEn = ordered
    .map((row) => `${titleCase(row.key)} passes ${row.passed}/${row.count} (${Math.round(row.passRateValue * 100)}%)`)
    .join(", ");
  const scoreJa = ordered
    .map((row) => `${titleCase(row.key)} は ${row.passed}/${row.count} 件 (${Math.round(row.passRateValue * 100)}%) に成功`)
    .join("、");
  const fastest = rows
    .filter((row) => typeof row.medianWallMs === "number")
    .toSorted((a, b) => a.medianWallMs - b.medianWallMs)[0];
  const cheapest = rows
    .map((row) => {
      const cost = row.reportedCost ?? row.estimatedCost;
      return { ...row, costPerPass: cost != null && row.passed > 0 ? cost / row.passed : null };
    })
    .filter((row) => typeof row.costPerPass === "number")
    .toSorted((a, b) => a.costPerPass - b.costPerPass)[0];
  const invalidCount = results.filter((result) => result.invalid_run).length;
  return {
    en: `This report compares memory-disabled agent harness conditions on ${caseCount} real-repository debugging cases. ${scoreEn}. ${titleCase(bestHarness(rows)?.key ?? "unknown")} has the highest hidden-test pass rate, ${titleCase(fastest?.key ?? "unknown")} has the fastest median wall time, and ${titleCase(cheapest?.key ?? "unknown")} has the lowest cost per pass. Invalid runs: ${invalidCount}.`,
    ja: `この report は、memory を無効化した agent harness 条件を、${caseCount} 件の実リポジトリ debug case で比較します。${scoreJa}。hidden-test 成功率は ${titleCase(bestHarness(rows)?.key ?? "unknown")} が最高、wall time 中央値は ${titleCase(fastest?.key ?? "unknown")} が最速、成功あたり cost は ${titleCase(cheapest?.key ?? "unknown")} が最小です。Invalid run は ${invalidCount} 件です。`,
  };
}

function bestHarness(rows) {
  return rows.toSorted((a, b) => b.passRateValue - a.passRateValue || b.passed - a.passed)[0];
}

function titleCase(value) {
  const text = String(value ?? "");
  return text ? `${text.slice(0, 1).toUpperCase()}${text.slice(1)}` : text;
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
        passRateValue: group.length ? passed / group.length : 0,
        passRate: group.length ? `${Math.round((passed / group.length) * 100)}%` : "n/a",
        medianWallMs: wall,
        reportedCost: reported.length ? reported.reduce((sum, value) => sum + value, 0) : null,
        estimatedCost: estimated.length ? estimated.reduce((sum, value) => sum + value, 0) : null,
      };
    });
}

function failureSummary(results) {
  const groups = new Map();
  for (const result of results) {
    const failure = classifyFailure(result);
    const group = groups.get(failure.category) ?? [];
    group.push(result);
    groups.set(failure.category, group);
  }
  return [...groups.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([key, group]) => ({
      key,
      count: group.length,
      medianWallMs: median(group.map((result) => result.metrics?.wall_time_ms).filter((value) => typeof value === "number")),
    }));
}

function conditionSummary(results) {
  return groupSummary(results, (result) => displayCondition(result))
    .map((row) => {
      const group = results.filter((result) => displayCondition(result) === row.key);
      const costValues = group
        .map((result) => result.metrics?.usage?.cost_usd)
        .filter((value) => typeof value === "number");
      const costSource = group.find((result) => result.metrics?.usage?.cost_source && result.metrics.usage.cost_source !== "unavailable")?.metrics?.usage?.cost_source ?? "unavailable";
      const passed = group.filter((result) => result.success).length;
      return {
        ...row,
        harness: group[0]?.harness ?? "",
        model: group[0]?.model ?? group[0]?.metrics?.harness?.model ?? "",
        cost: costValues.length ? costValues.reduce((sum, value) => sum + value, 0) : null,
        costSource,
        costPerPass: passed && costValues.length ? costValues.reduce((sum, value) => sum + value, 0) / passed : null,
      };
    })
    .sort((a, b) => b.passRateValue - a.passRateValue || a.key.localeCompare(b.key));
}

function renderConditionCards(rows) {
  return rows.map((row) => `
    <article class="condition-card">
      <h2>${esc(row.harness)} · ${esc(row.model)}</h2>
      <div class="condition-main">
        <div class="condition-rate">${esc(row.passRate)}</div>
        <div class="condition-meta">${fmt(row.passed)}/${fmt(row.count)} <span data-i18n="passedSuffix">pass</span></div>
      </div>
      <div class="condition-stats">
        <div><span data-i18n="medianWallLabel">Median wall</span><strong>${fmtMs(row.medianWallMs)}</strong></div>
        <div><span data-i18n="costPerPassLabel">Cost/pass</span><strong>${row.costPerPass == null ? "n/a" : `$${row.costPerPass.toFixed(2)}`}</strong></div>
        <div><span data-i18n="costSourceLabel">Cost source</span><strong data-i18n="${escAttr(costSourceKey(row.costSource))}">${esc(row.costSource)}</strong></div>
      </div>
    </article>
  `).join("\n");
}

function renderCharts(results) {
  const conditions = conditionSummary(results);
  const maxWall = Math.max(...conditions.map((row) => row.medianWallMs ?? 0), 1);
  const maxCost = Math.max(...conditions.map((row) => row.costPerPass ?? 0), 1);
  const byHarnessDifficulty = groupByHarnessDifficulty(results);
  return `
    <article class="chart-card">
      <h2 data-i18n="passRateChart">Pass Rate</h2>
      ${conditions.map((row) => barRow(row.harness, row.passRateValue * 100, 100, row.passRate, "")).join("\n")}
    </article>
    <article class="chart-card">
      <h2 data-i18n="wallTimeChart">Median Wall Time</h2>
      ${conditions.map((row) => barRow(row.harness, row.medianWallMs ?? 0, maxWall, fmtMs(row.medianWallMs), "secondary")).join("\n")}
    </article>
    <article class="chart-card">
      <h2 data-i18n="costPassChart">Cost Per Pass</h2>
      ${conditions.map((row) => barRow(row.harness, row.costPerPass ?? 0, maxCost, row.costPerPass == null ? "n/a" : `$${row.costPerPass.toFixed(2)}`, "cost")).join("\n")}
    </article>
    <article class="chart-card">
      <h2 data-i18n="difficultyChart">Success By Difficulty</h2>
      ${byHarnessDifficulty.map((row) => `
        <div class="stack-row">
          <div class="bar-label">${esc(row.harness)}</div>
          <div class="stack-track" title="${escAttr(`low ${row.low}/9, mid ${row.mid}/9, high ${row.high}/9`)}">
            <div class="stack-seg stack-low">${row.low}/9</div>
            <div class="stack-seg stack-mid">${row.mid}/9</div>
            <div class="stack-seg stack-high">${row.high}/9</div>
          </div>
        </div>
      `).join("\n")}
    </article>
  `;
}

function barRow(label, value, max, display, className) {
  const width = Math.max(2, Math.round((value / max) * 100));
  return `
    <div class="bar-row">
      <div class="bar-label" title="${escAttr(label)}">${esc(label)}</div>
      <div class="bar-track"><div class="bar-fill ${escAttr(className)}" style="width:${width}%"></div></div>
      <div class="bar-value">${esc(display)}</div>
    </div>
  `;
}

function groupByHarnessDifficulty(results) {
  return unique(results.map((result) => result.harness)).map((harness) => {
    const group = results.filter((result) => result.harness === harness && result.success);
    return {
      harness,
      low: group.filter((result) => caseMeta(result).difficulty === "low").length,
      mid: group.filter((result) => caseMeta(result).difficulty === "mid").length,
      high: group.filter((result) => caseMeta(result).difficulty === "high").length,
    };
  });
}

function renderMatrixGrid(results) {
  const conditions = unique(results.map((result) => displayCondition(result)));
  const caseIds = unique(results.map((result) => result.case_id));
  const cells = [];
  cells.push(`<div class="matrix-cell matrix-head">Case</div>`);
  for (const condition of conditions) {
    cells.push(`<div class="matrix-cell matrix-head">${esc(shortCondition(condition))}</div>`);
  }
  for (const caseId of caseIds) {
    const sample = results.find((result) => result.case_id === caseId);
    const meta = caseMeta(sample ?? {});
    cells.push(`<div class="matrix-cell"><div class="case-name" title="${escAttr(caseId)}">${esc(caseId)}</div><div class="case-sub">${esc(meta.difficulty ?? "")} · ${esc(meta.size_bucket ?? "")}</div></div>`);
    for (const condition of conditions) {
      const result = results.find((row) => row.case_id === caseId && displayCondition(row) === condition);
      if (!result) {
        cells.push(`<div class="matrix-cell muted">n/a</div>`);
      } else {
        cells.push(`<div class="matrix-cell"><span class="result-dot ${result.success ? "result-pass" : "result-fail"}" data-i18n="${result.success ? "passValue" : "failValue"}">${result.success ? "pass" : "fail"}</span></div>`);
      }
    }
  }
  return `<div class="matrix-grid" style="--condition-count:${conditions.length}">${cells.join("\n")}</div>`;
}

function shortCondition(condition) {
  return String(condition)
    .replace("codex:gpt-5.5:medium:baseline", "Codex")
    .replace("claude:claude-opus-4-7:medium:baseline", "Claude")
    .replace("cursor:gpt-5.5-medium:baseline", "Cursor");
}

function falseNegativeSummary(results) {
  const failedByCase = new Map();
  for (const result of results.filter((result) => !result.success)) {
    const group = failedByCase.get(result.case_id) ?? [];
    group.push(result);
    failedByCase.set(result.case_id, group);
  }
  return [...failedByCase.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([caseId, group]) => {
    const evidence = group.map((result) => classifyFailure(result).detail).filter(Boolean).join(" ");
    const review = isReviewFalseNegativeCase(caseId);
    return {
      caseId,
      harnesses: group.map((result) => result.harness).sort().join(", "),
      verdict: review ? "review" : "unlikely false negative",
      verdictKey: review ? "reviewVerdict" : "unlikelyFalseNegative",
      evidence: review ? review : truncate(evidence, 240),
    };
  });
}

function isReviewFalseNegativeCase(caseId) {
  return falseNegativeNoteTranslations()[caseId]?.en ?? "";
}

function falseNegativeNoteTranslations() {
  return {
    "axios-axios-low-settle-error-code": {
      en: "Fixed hidden-test false negative: rejected non-success statuses may use any defined Axios bad request/response code. All three pass after regrade.",
      ja: "hidden-test false negative 修正済み: reject された non-success status は定義済み Axios bad request/response code なら許容します。再採点後は 3 harness すべて pass です。",
    },
    "go-gitea-gitea-high-compare-no-common-history": {
      en: "Fixed hidden-test false negative: the hidden test now accepts equivalent no-merge-base typed behavior instead of one exact errors.Is path. All three pass after regrade.",
      ja: "hidden-test false negative 修正済み: hidden test は単一の errors.Is path ではなく、同等の no-merge-base typed behavior を許容します。再採点後は 3 harness すべて pass です。",
    },
    "jesseduffield-lazygit-high-branch-divergence-fast-path": {
      en: "Fixed hidden-test false negative: private helper-name assertions were removed. Codex and Cursor pass after regrade; Claude still fails the public batching behavior.",
      ja: "hidden-test false negative 修正済み: private helper-name assertion を削除しました。再採点後 Codex/Cursor は pass、Claude は public batching behavior でまだ fail です。",
    },
    "louislam-uptime-kuma-high-websocket-auth-options": {
      en: "Hidden tests were loosened for equivalent helper names and auth field spellings. All three still fail behavior checks, so this is now treated as true failure.",
      ja: "同等 helper 名と auth field spelling を許容するよう hidden test を緩和しました。それでも 3 harness すべて behavior check で fail するため、現在は true failure と扱います。",
    },
    "louislam-uptime-kuma-low-submillisecond-ping-chart": {
      en: "Fixed hidden-test false negative: the hidden test now evaluates the real helper method context instead of a fixed-signature mock. Codex, Claude, and Cursor pass after regrade.",
      ja: "hidden-test false negative 修正済み: hidden test は fixed-signature mock ではなく実際の helper method context を評価します。再採点後 Codex/Claude/Cursor は pass です。",
    },
    "sharkdp-bat-high-fallback-syntax": {
      en: "Mixed: Codex/Cursor implemented --fallback-syntax but hidden also requires an unstated --fallback-language alias; Claude appears to be a true failure because --fallback-syntax itself is rejected.",
      ja: "混在: Codex/Cursor は --fallback-syntax を実装しましたが、hidden test は prompt にない --fallback-language alias も要求しています。Claude は --fallback-syntax 自体を拒否しているため true failure と見なせます。",
    },
    "vitejs-vite-low-flatten-id-sanitized-chars": {
      en: "Fixed hidden-test false negative: exact PR-style encoding checks were replaced by uniqueness and path-safety properties. Cursor passes after regrade; Codex still leaves unsafe characters.",
      ja: "hidden-test false negative 修正済み: exact PR-style encoding check を uniqueness と path-safety property に置き換えました。再採点後 Cursor は pass、Codex は unsafe character が残るため fail です。",
    },
  };
}

function renderFalseNegativeRows(rows) {
  return rows.map((row) => `
    <div class="review-row">
      <div>${esc(row.caseId)}<div class="case-sub">${esc(row.harnesses)}</div></div>
      <div>${badge(row.verdict, row.verdict === "review" ? "failure-badge" : "", row.verdictKey)}</div>
      <div${isReviewFalseNegativeCase(row.caseId) ? ` data-note-case="${escAttr(row.caseId)}"` : ""}>${esc(row.evidence)}</div>
    </div>
  `).join("\n");
}

function renderFailureReviewRows(results) {
  const failedKeys = new Set(results.filter((result) => !result.success).map((result) => reviewKey(result.case_id, result.harness)));
  const rows = failureReviews
    .filter((review) => failedKeys.has(reviewKey(review.case_id, review.harness)))
    .sort((a, b) => a.case_id.localeCompare(b.case_id) || a.harness.localeCompare(b.harness));
  if (rows.length === 0) {
    return `<div class="muted" data-i18n="noFailures">No failures</div>`;
  }
  return rows.map((review) => {
    const key = reviewKey(review.case_id, review.harness);
    return `
      <article class="failure-review-card">
        <h3>${esc(review.case_id)}</h3>
        <div class="failure-review-meta">
          ${badge(review.harness)}
          ${badge(review.verdict, review.verdict === "true_failure" ? "fail-badge" : "failure-badge")}
          ${badge(review.confidence ?? "")}
        </div>
        <p><strong data-i18n="failureLabel">Failure:</strong> <span data-review-key="${escAttr(key)}" data-review-field="failure_mode">${esc(localized(review.failure_mode, "en"))}</span></p>
        <p><strong data-i18n="evidenceLabel">Evidence:</strong> <span data-review-key="${escAttr(key)}" data-review-field="evidence">${esc(localized(review.evidence, "en"))}</span></p>
        <p><strong data-i18n="recommendationLabel">Recommendation:</strong> <span data-review-key="${escAttr(key)}" data-review-field="recommendation">${esc(localized(review.recommendation, "en"))}</span></p>
      </article>
    `;
  }).join("\n");
}

function loadFailureReviews(path) {
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf8"));
  validateFailureReviewData(data, path);
  return data.reviews ?? [];
}

function reviewKey(caseId, harness) {
  return `${caseId}::${harness}`;
}

function failureReviewTranslations() {
  return Object.fromEntries(failureReviews.map((review) => [reviewKey(review.case_id, review.harness), {
    failure_mode: review.failure_mode,
    evidence: review.evidence,
    recommendation: review.recommendation,
  }]));
}

function validateFailureReviewData(data, path) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${path}: failure review file must be a JSON object`);
  }
  if (!Array.isArray(data.reviews)) {
    throw new Error(`${path}: reviews must be an array`);
  }
  const seen = new Set();
  for (const [index, review] of data.reviews.entries()) {
    const prefix = `${path}: reviews[${index}]`;
    requireString(review.case_id, `${prefix}.case_id`);
    requireString(review.harness, `${prefix}.harness`);
    if (!["codex", "claude", "cursor"].includes(review.harness)) {
      throw new Error(`${prefix}.harness must be codex, claude, or cursor`);
    }
    requireString(review.verdict, `${prefix}.verdict`);
    if (!["true_failure", "core_false_negative", "regression_false_negative", "case_design_review", "infra_failure"].includes(review.verdict)) {
      throw new Error(`${prefix}.verdict has unsupported value ${review.verdict}`);
    }
    requireLocalized(review.failure_mode, `${prefix}.failure_mode`);
    requireLocalized(review.evidence, `${prefix}.evidence`);
    requireLocalized(review.recommendation, `${prefix}.recommendation`);
    const key = reviewKey(review.case_id, review.harness);
    if (seen.has(key)) throw new Error(`${prefix}: duplicate review key ${key}`);
    seen.add(key);
  }
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function requireLocalized(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object with en and ja strings`);
  }
  requireString(value.en, `${name}.en`);
  requireString(value.ja, `${name}.ja`);
}

function localized(value, lang) {
  if (value && typeof value === "object") return value[lang] ?? value.en ?? "";
  return value ?? "";
}

function renderCaseCatalog(results) {
  return unique(results.map((result) => result.case_id)).map((caseId) => {
    const sample = results.find((result) => result.case_id === caseId);
    const meta = caseMeta(sample ?? {});
    return `
      <article class="case-card">
        <h3>${esc(caseId)}</h3>
        <div>${badge(meta.difficulty ?? "")} ${badge(meta.size_bucket ?? "")} ${badge(sample?.repo ?? "")}</div>
        <p>${esc(meta.instruction ?? "")}</p>
        <p class="case-sub">${esc(meta.selection_notes ?? "")}</p>
      </article>
    `;
  }).join("\n");
}

function renderSummaryTable(title, i18nKey, rows) {
  return `
      <div class="summary-table">
        <h2 data-i18n="${escAttr(i18nKey)}">${esc(title)}</h2>
        <table>
          <thead><tr><th data-i18n="name">Name</th><th data-i18n="runs">Runs</th><th data-i18n="pass">Pass</th><th data-i18n="rate">Rate</th><th data-i18n="medianWallShort">Median Wall</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="muted">No runs</td></tr>`}</tbody>
        </table>
      </div>
    `;
}

function renderFailureSummaryTable(title, i18nKey, rows) {
  return `
      <div class="summary-table">
        <h2 data-i18n="${escAttr(i18nKey)}">${esc(title)}</h2>
        <table>
          <thead><tr><th data-i18n="name">Name</th><th data-i18n="runs">Runs</th><th data-i18n="medianWallShort">Median Wall</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="3" class="muted">No failures</td></tr>`}</tbody>
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
    </tr>
  `).join("\n");
}

function renderFailureSummaryRows(rows) {
  return rows.map((row) => `
    <tr>
      <td><span data-i18n="${escAttr(failureCategoryKey(row.key))}">${esc(row.key)}</span></td>
      <td>${fmt(row.count)}</td>
      <td>${fmtMs(row.medianWallMs)}</td>
    </tr>
  `).join("\n");
}

function renderSelect(id, label, values, i18nKey = null) {
  return `
    <label><span${i18nKey ? ` data-i18n="${escAttr(i18nKey)}"` : ""}>${esc(label)}</span>
      <select id="${escAttr(id)}">
        ${values.map((value) => {
          const key = optionI18nKey(id, value);
          return `<option value="${escAttr(value ?? "")}"${key ? ` data-i18n="${escAttr(key)}"` : ""}>${esc(optionLabel(id, value))}</option>`;
        }).join("\n")}
      </select>
    </label>
  `;
}

function optionI18nKey(id, value) {
  if (!value) return "allOption";
  const keys = {
    "language-filter:en": "optionEn",
    "language-filter:ja": "optionJa",
    "view-filter:baseline": "optionBaseline",
    "view-filter:all": "optionAllViews",
    "view-filter:pilot-smoke": "optionPilotSmoke",
    "result-filter:pass": "optionPass",
    "result-filter:fail": "optionFail",
  };
  return keys[`${id}:${value}`] ?? "";
}

function optionLabel(id, value) {
  if (!value) return "All";
  const labels = {
    "language-filter:en": "English",
    "language-filter:ja": "Japanese",
    "view-filter:baseline": "Baseline",
    "view-filter:all": "All runs",
    "view-filter:pilot-smoke": "Pilot/Smoke",
  };
  return labels[`${id}:${value}`] ?? value;
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

function loadCaseMetadata(path) {
  if (!path) return {};
  const resolved = resolve(path);
  if (caseMetadataCache.has(resolved)) return caseMetadataCache.get(resolved);
  if (!existsSync(resolved)) return {};
  const text = readFileSync(resolved, "utf8");
  const metadata = {
    difficulty: scalarField(text, "difficulty"),
    size_bucket: scalarField(text, "size_bucket"),
    language_tags: listField(text, "language_tags"),
    license: scalarField(text, "license"),
    stars_at_selection: numericField(text, "stars_at_selection"),
    pr_number: numericField(text, "pr_number"),
    pr_url: scalarField(text, "pr_url"),
    pr_title: scalarField(text, "pr_title"),
    merged_at: scalarField(text, "merged_at"),
    base_commit: scalarField(text, "base_commit"),
    fixed_commit: scalarField(text, "fixed_commit"),
    instruction: blockField(text, "instruction"),
    selection_notes: blockField(text, "selection_notes"),
  };
  caseMetadataCache.set(resolved, metadata);
  return metadata;
}

function scalarField(text, key) {
  const match = text.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, "m"));
  if (!match) return null;
  const value = match[1].trim();
  if (value === "null") return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function numericField(text, key) {
  const value = scalarField(text, key);
  return /^-?\d+$/.test(String(value)) ? Number(value) : null;
}

function listField(text, key) {
  const value = scalarField(text, key);
  if (!value?.startsWith("[") || !value.endsWith("]")) return [];
  return value.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean);
}

function blockField(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return null;
  const first = lines[start].slice(key.length + 1).trim();
  if (first && first !== ">" && first !== "|") return first.replace(/^['"]|['"]$/g, "");
  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z0-9_]+:/.test(line)) break;
    collected.push(line.replace(/^  /, ""));
  }
  return collected.join(" ").replace(/\s+/g, " ").trim() || null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function badge(value, className = "", i18nKey = "") {
  const text = String(value ?? "");
  if (!text) return "";
  return `<span class="badge ${escAttr(className)}" title="${escAttr(text)}"${i18nKey ? ` data-i18n="${escAttr(i18nKey)}"` : ""}>${esc(text)}</span>`;
}

function failureCategoryKey(category) {
  const keys = {
    "hidden test failure": "failureHiddenTest",
    "build or symbol failure": "failureBuildSymbol",
    "wrong CLI/API surface": "failureWrongSurface",
    "hidden assertion mismatch": "failureAssertion",
  };
  return keys[category] ?? "";
}

function costSourceKey(source) {
  const keys = {
    reported: "costSourceReported",
    estimated: "costSourceEstimated",
    unavailable: "costSourceUnavailable",
  };
  return keys[source] ?? "";
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

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function required(value, message) {
  if (value == null || value === "") throw new Error(message);
  return value;
}
