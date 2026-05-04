#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const experimentsRoot = resolve(args.experimentsRoot ?? "benchmark/experiments");
const output = resolve(args.output ?? "benchmark/reports/index.html");

const experiments = loadExperiments(experimentsRoot);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${renderHtml(experiments).replace(/[ \t]+$/gm, "")}\n`);
console.log(output);

function loadExperiments(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = resolve(root, entry.name);
      const manifestPath = resolve(dir, "manifest.json");
      const summaryPath = resolve(dir, "summary.json");
      if (!existsSync(manifestPath) || !existsSync(summaryPath)) return null;
      return {
        id: entry.name,
        dir,
        manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
        summary: JSON.parse(readFileSync(summaryPath, "utf8")),
        reportPath: resolve(dir, "results.html"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.manifest.created_at).localeCompare(String(a.manifest.created_at)));
}

function renderHtml(experiments) {
  const conditionRows = experiments.flatMap((experiment) =>
    Object.entries(experiment.summary.conditions ?? {}).map(([conditionId, condition]) => ({
      experiment,
      conditionId,
      ...condition,
    })),
  ).sort((a, b) => String(a.conditionId).localeCompare(String(b.conditionId)));
  const rows = experiments.map((experiment) => {
    const summary = experiment.summary;
    const manifest = experiment.manifest;
    const rate = summary.agent_runs ? `${Math.round((summary.passed / summary.agent_runs) * 100)}%` : "n/a";
    const reportHref = existsSync(experiment.reportPath)
      ? relative(dirname(output), experiment.reportPath)
      : "";
    return `
      <tr>
        <td><code>${esc(experiment.id)}</code></td>
        <td><code>${esc(manifest.matrix_id)}</code></td>
        <td>${esc(manifest.created_at ?? "")}</td>
        <td>${fmt(summary.agent_runs)}</td>
        <td>${fmt(summary.passed)}</td>
        <td>${esc(rate)}</td>
        <td>${fmtMs(summary.duration_ms)}</td>
        <td>${summary.success ? "yes" : "no"}</td>
        <td>${reportHref ? `<a href="${escAttr(reportHref)}">report</a>` : ""}</td>
      </tr>
    `;
  }).join("\n");
  const comparisonRows = conditionRows.map((row) => {
    const reportHref = existsSync(row.experiment.reportPath)
      ? relative(dirname(output), row.experiment.reportPath)
      : "";
    return `
      <tr>
        <td><code>${esc(row.conditionId)}</code></td>
        <td><code>${esc(row.experiment.id)}</code></td>
        <td>${fmt(row.runs)}</td>
        <td>${fmt(row.passed)}</td>
        <td>${row.pass_rate == null ? "n/a" : `${Math.round(row.pass_rate * 100)}%`}</td>
        <td>${fmtMs(row.median_wall_time_ms)}</td>
        <td>${typeof row.cost_usd === "number" ? `$${row.cost_usd.toFixed(4)}` : "n/a"}</td>
        <td>${reportHref ? `<a href="${escAttr(reportHref)}">report</a>` : ""}</td>
      </tr>
    `;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HarnessBench Experiments</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #202124; background: #f7f7f4; }
    body { margin: 0; }
    header { background: #fff; border-bottom: 1px solid #dededb; padding: 28px 32px 18px; }
    main { padding: 24px 32px 40px; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { margin: 0; color: #5f6368; }
    .panel { background: #fff; border: 1px solid #dededb; border-radius: 8px; overflow-x: auto; }
    .panel + .panel { margin-top: 18px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #ededeb; text-align: left; white-space: nowrap; }
    th { background: #fafaf8; color: #4b4f56; font-weight: 650; }
    tr:last-child td { border-bottom: 0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    a { color: #1a5f8f; }
    .empty { padding: 14px; color: #5f6368; }
  </style>
</head>
<body>
  <header>
    <h1>HarnessBench Experiments</h1>
    <p>Immutable experiment reports. Raw run logs remain local under the configured runs root.</p>
  </header>
  <main>
    <section class="panel">
      ${comparisonRows ? `<table>
        <thead><tr><th>Condition</th><th>Experiment</th><th>Runs</th><th>Pass</th><th>Rate</th><th>Median Wall</th><th>Cost</th><th>Report</th></tr></thead>
        <tbody>${comparisonRows}</tbody>
      </table>` : `<div class="empty">No condition summaries have been generated yet.</div>`}
    </section>
    <section class="panel">
      ${rows ? `<table>
        <thead><tr><th>Experiment</th><th>Matrix</th><th>Created</th><th>Runs</th><th>Pass</th><th>Rate</th><th>Duration</th><th>Success</th><th>Report</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : `<div class="empty">No experiments have been generated yet.</div>`}
    </section>
  </main>
</body>
</html>`;
}

function fmt(value) {
  return value == null ? "" : Number(value).toLocaleString();
}

function fmtMs(value) {
  if (value == null) return "";
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${(value / 60_000).toFixed(1)}m`;
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
