#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));

const since = args.since ?? "2026-01-01";
const minStars = Number(args.minStars ?? 500);
const minMergedPrs = Number(args.minMergedPrs ?? 50);
const perQuery = Number(args.perQuery ?? 20);
const output = resolve(args.output ?? "benchmark/repos/candidates.json");
const yamlOutput = output.replace(/\.json$/i, ".yaml");

const permissiveLicenses = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
]);

const languageQueries = [
  { bucket: "typescript", query: `language:TypeScript stars:>=${minStars} pushed:>=${since} archived:false` },
  { bucket: "javascript", query: `language:JavaScript stars:>=${minStars} pushed:>=${since} archived:false` },
  { bucket: "python", query: `language:Python stars:>=${minStars} pushed:>=${since} archived:false` },
  { bucket: "rust", query: `language:Rust stars:>=${minStars} pushed:>=${since} archived:false` },
  { bucket: "go", query: `language:Go stars:>=${minStars} pushed:>=${since} archived:false` },
  { bucket: "ruby", query: `language:Ruby stars:>=${minStars} pushed:>=${since} archived:false` },
  { bucket: "java", query: `language:Java stars:>=${minStars} pushed:>=${since} archived:false` },
  { bucket: "kotlin", query: `language:Kotlin stars:>=${minStars} pushed:>=${since} archived:false` },
  { bucket: "php", query: `language:PHP stars:>=${minStars} pushed:>=${since} archived:false` },
];

const repoSearchQuery = String.raw`
query RepoSearch($searchQuery: String!, $first: Int!) {
  search(query: $searchQuery, type: REPOSITORY, first: $first) {
    nodes {
      ... on Repository {
        nameWithOwner
        url
        stargazerCount
        forkCount
        isArchived
        isFork
        pushedAt
        primaryLanguage { name }
        licenseInfo { spdxId name }
        defaultBranchRef { name target { oid } }
      }
    }
  }
}
`;

const prCountQuery = String.raw`
query MergedPrCount($searchQuery: String!) {
  search(query: $searchQuery, type: ISSUE, first: 1) {
    issueCount
  }
}
`;

const prSampleQuery = String.raw`
query MergedPrSample($owner: String!, $name: String!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: $first, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        mergedAt
        changedFiles
        additions
        deletions
        labels(first: 10) { nodes { name } }
      }
    }
  }
}
`;

const seen = new Set();
const candidates = [];

for (const { bucket, query } of languageQueries) {
  console.error(`searching ${bucket}: ${query}`);
  const data = ghGraphql(repoSearchQuery, { searchQuery: query, first: perQuery });
  const repos = data.search.nodes.filter(Boolean);

  for (const repo of repos) {
    if (seen.has(repo.nameWithOwner)) continue;
    seen.add(repo.nameWithOwner);

    const license = repo.licenseInfo?.spdxId ?? "NOASSERTION";
    if (!permissiveLicenses.has(license)) continue;
    if (repo.isArchived || repo.isFork) continue;

    const mergedPrSearch = `repo:${repo.nameWithOwner} is:pr is:merged merged:>=${since}`;
    const mergedPrCount = ghGraphql(prCountQuery, { searchQuery: mergedPrSearch }).search.issueCount;
    if (mergedPrCount < minMergedPrs) continue;

    const [owner, name] = repo.nameWithOwner.split("/");
    const prSample = ghGraphql(prSampleQuery, { owner, name, first: 10 })
      .repository
      .pullRequests
      .nodes
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        mergedAt: pr.mergedAt,
        changedFiles: pr.changedFiles,
        additions: pr.additions,
        deletions: pr.deletions,
        labels: pr.labels.nodes.map((label) => label.name),
      }));

    candidates.push({
      bucket,
      nameWithOwner: repo.nameWithOwner,
      url: repo.url,
      stars: repo.stargazerCount,
      forks: repo.forkCount,
      pushedAt: repo.pushedAt,
      primaryLanguage: repo.primaryLanguage?.name ?? null,
      license,
      defaultBranch: repo.defaultBranchRef?.name ?? null,
      defaultBranchOid: repo.defaultBranchRef?.target?.oid ?? null,
      mergedPrCountSince: mergedPrCount,
      mergedPrCountSinceDate: since,
      recentMergedPrSample: prSample,
    });

    console.error(`  kept ${repo.nameWithOwner} (${mergedPrCount} merged PRs since ${since})`);
  }
}

candidates.sort((a, b) => {
  if (b.mergedPrCountSince !== a.mergedPrCountSince) {
    return b.mergedPrCountSince - a.mergedPrCountSince;
  }
  return b.stars - a.stars;
});

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), filters: { since, minStars, minMergedPrs, perQuery, permissiveLicenses: [...permissiveLicenses] }, candidates }, null, 2)}\n`);
writeFileSync(yamlOutput, toYaml({ generatedAt: new Date().toISOString(), filters: { since, minStars, minMergedPrs, perQuery, permissiveLicenses: [...permissiveLicenses] }, candidates }));

console.error(`wrote ${candidates.length} candidates to ${output}`);
console.error(`wrote ${candidates.length} candidates to ${yamlOutput}`);

function ghGraphql(query, variables) {
  const fields = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    fields.push("-F", `${key}=${value}`);
  }

  const result = spawnSync("gh", fields, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
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
  if (/^[A-Za-z0-9_./:@-]+$/.test(text)) return text;
  return JSON.stringify(text);
}
