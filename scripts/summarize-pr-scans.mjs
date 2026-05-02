#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const targetsPath = resolve(process.argv[2] ?? "benchmark/repos/app-pr-scan-targets.txt");
const output = resolve(process.argv[3] ?? "benchmark/repos/app-pr-scan-summary.md");

const targets = readFileSync(targetsPath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const rows = [];

for (const repo of targets) {
  const file = resolve(`benchmark/repos/pr-candidates/${repo.replace("/", "__")}.json`);
  const data = JSON.parse(readFileSync(file, "utf8"));
  const prs = data.prs;
  const debug = prs.filter((pr) => pr.debugScore > 0);
  const byDifficulty = countBy(debug, (pr) => pr.suggestedDifficulty);
  const top = debug
    .filter((pr) => pr.suggestedDifficulty !== "reject")
    .sort((a, b) => b.debugScore - a.debugScore || a.additions + a.deletions - (b.additions + b.deletions))
    .slice(0, 5)
    .map((pr) => `#${pr.number} ${pr.suggestedDifficulty} ${escapePipes(pr.title)}`)
    .join("<br>");

  rows.push({
    repo,
    total: prs.length,
    debug: debug.length,
    low: byDifficulty.low ?? 0,
    mid: byDifficulty.mid ?? 0,
    high: byDifficulty.high ?? 0,
    reject: byDifficulty.reject ?? 0,
    top,
  });
}

rows.sort((a, b) => b.debug - a.debug || b.low + b.mid + b.high - (a.low + a.mid + a.high));

const markdown = [
  "# App-Oriented PR Scan Summary",
  "",
  `Generated at: ${new Date().toISOString()}`,
  "",
  "| Repo | PRs | Debug-like | Low | Mid | High | Reject | Top candidates |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ...rows.map((row) => `| \`${row.repo}\` | ${row.total} | ${row.debug} | ${row.low} | ${row.mid} | ${row.high} | ${row.reject} | ${row.top || ""} |`),
  "",
].join("\n");

writeFileSync(output, markdown);
console.log(markdown);

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function escapePipes(value) {
  return String(value).replaceAll("|", "\\|");
}
