#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const repo = required(args.repo, "--repo owner/name is required");
const limit = Number(args.limit ?? 50);
const since = args.since ?? "2026-01-01";
const output = resolve(args.output ?? `benchmark/repos/pr-candidates/${repo.replace("/", "__")}.json`);
const yamlOutput = output.replace(/\.json$/i, ".yaml");
const [owner, name] = repo.split("/");

const debugKeywords = [
  "bug",
  "fix",
  "regression",
  "crash",
  "incorrect",
  "wrong",
  "error",
  "exception",
  "edge",
  "flaky",
  "race",
  "leak",
  "validation",
  "parser",
  "parsing",
  "timeout",
  "fail",
  "failure",
  "broken",
];

const testPathPatterns = [
  /(^|\/)(test|tests|spec|specs|__tests__)(\/|$)/i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /_test\.(go|py|rb)$/i,
  /Test\.(java|kt)$/i,
];

const query = String.raw`
query PullRequests($owner: String!, $name: String!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    url
    pullRequests(first: $first, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        bodyText
        url
        mergedAt
        baseRefName
        headRefName
        baseRefOid
        headRefOid
        mergeCommit { oid }
        changedFiles
        additions
        deletions
        labels(first: 20) { nodes { name } }
        files(first: 60) {
          nodes {
            path
            additions
            deletions
            changeType
          }
        }
      }
    }
  }
}
`;

const data = ghGraphql(query, { owner, name, first: limit });
const prs = data.repository.pullRequests.nodes
  .filter((pr) => pr.mergedAt >= `${since}T00:00:00Z`)
  .map((pr) => enrichPr(pr));

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), repo, since, limit, debugKeywords, prs }, null, 2)}\n`);
writeFileSync(yamlOutput, toYaml({ generatedAt: new Date().toISOString(), repo, since, limit, debugKeywords, prs }));

const debugCount = prs.filter((pr) => pr.debugScore > 0).length;
console.error(`wrote ${prs.length} merged PRs (${debugCount} debug-like) to ${output}`);
console.error(`wrote ${prs.length} merged PRs (${debugCount} debug-like) to ${yamlOutput}`);

function enrichPr(pr) {
  const labels = pr.labels.nodes.map((label) => label.name);
  const files = pr.files.nodes;
  const testFiles = files.filter((file) => testPathPatterns.some((pattern) => pattern.test(file.path)));
  const text = `${pr.title}\n${pr.bodyText}\n${labels.join("\n")}\n${files.map((file) => file.path).join("\n")}`.toLowerCase();
  const keywordHits = debugKeywords.filter((keyword) => text.includes(keyword));
  const hasTests = testFiles.length > 0;
  const touchesManyFiles = pr.changedFiles > 8;
  const hugeDiff = pr.additions + pr.deletions > 1200;
  const likelyDependency = /dependabot|renovate|bump|upgrade dependency|update dependency/i.test(text);
  const likelyDocsOnly = files.length > 0 && files.every((file) => /\.(md|mdx|rst|txt)$/i.test(file.path) || file.path.startsWith("docs/"));

  let debugScore = keywordHits.length;
  if (hasTests) debugScore += 2;
  if (touchesManyFiles) debugScore -= 1;
  if (hugeDiff) debugScore -= 2;
  if (likelyDependency) debugScore -= 4;
  if (likelyDocsOnly) debugScore -= 4;

  const suggestedDifficulty = suggestDifficulty(pr, hasTests, debugScore);

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    mergedAt: pr.mergedAt,
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    baseRefOid: pr.baseRefOid,
    headRefOid: pr.headRefOid,
    mergeCommitOid: pr.mergeCommit?.oid ?? null,
    changedFiles: pr.changedFiles,
    additions: pr.additions,
    deletions: pr.deletions,
    labels,
    keywordHits,
    hasTests,
    testFiles: testFiles.map((file) => file.path),
    debugScore,
    suggestedDifficulty,
    exclusionHints: [
      likelyDependency ? "dependency-update" : null,
      likelyDocsOnly ? "docs-only" : null,
      hugeDiff ? "huge-diff" : null,
      !hasTests ? "no-test-files-in-first-60-files" : null,
    ].filter(Boolean),
    files: files.map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      changeType: file.changeType,
    })),
  };
}

function suggestDifficulty(pr, hasTests, debugScore) {
  if (debugScore <= 0 || !hasTests) return "reject";
  const diffSize = pr.additions + pr.deletions;
  if (pr.changedFiles <= 3 && diffSize <= 250) return "low";
  if (pr.changedFiles <= 8 && diffSize <= 900) return "mid";
  return "high";
}

function ghGraphql(queryText, variables) {
  const fields = ["api", "graphql", "-f", `query=${queryText}`];
  for (const [key, value] of Object.entries(variables)) {
    fields.push("-F", `${key}=${value}`);
  }

  const result = spawnSync("gh", fields, {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(`gh api graphql failed:\n${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(result.stdout);
  if (parsed.errors?.length) {
    throw new Error(`gh api graphql returned errors:\n${JSON.stringify(parsed.errors, null, 2)}`);
  }
  return parsed.data ?? parsed;
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

function required(value, message) {
  if (!value) {
    console.error(message);
    process.exit(2);
  }
  return value;
}

function toYaml(value, indent = 0) {
  const space = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]\n";
    return value.map((item) => `${space}- ${formatYamlValue(item, indent + 2)}`).join("");
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${space}${key}: ${formatYamlValue(item, indent + 2)}`)
      .join("");
  }
  return `${space}${formatScalar(value)}\n`;
}

function formatYamlValue(value, indent) {
  if (Array.isArray(value) || (value && typeof value === "object")) {
    const rendered = toYaml(value, indent);
    return `\n${rendered}`;
  }
  return `${formatScalar(value)}\n`;
}

function formatScalar(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (/^[A-Za-z0-9_./:@#-]+$/.test(text)) return text;
  return JSON.stringify(text);
}
