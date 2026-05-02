#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const runsRoot = resolve(args.runsRoot ?? "benchmark/runs");
const rateCardPath = resolve(required(args.rateCard, "--rateCard <path> is required"));
const dryRun = args.dryRun === "true";
const card = loadRateCard(rateCardPath);

const resultPaths = readdirSync(runsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(runsRoot, entry.name, "result.json"))
  .filter((path) => existsSync(path));

let updated = 0;
for (const resultPath of resultPaths) {
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  const usage = result.metrics?.usage;
  if (!usage || usage.cost_source === "reported") continue;

  const modelName = result.metrics?.harness?.model ?? result.model;
  applyCostEstimate(usage, modelName, card);
  if (!dryRun) {
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  updated += 1;
  console.log(`${dryRun ? "would update" : "updated"} ${resultPath}: ${usage.cost_source}${usage.cost_usd == null ? "" : ` $${usage.cost_usd.toFixed(6)}`}`);
}

console.error(`${dryRun ? "would update" : "updated"} ${updated} results`);

function loadRateCard(path) {
  const raw = readFileSync(path, "utf8");
  const card = JSON.parse(raw);
  return {
    ...card,
    path,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

function applyCostEstimate(usage, modelName, card) {
  const canonicalModel = card.aliases?.[modelName] ?? modelName;
  const rates = card.models?.[canonicalModel];
  usage.rate_card = rateCardMetadata(card, canonicalModel);

  if (!rates) {
    usage.cost_usd = null;
    usage.cost_source = "unavailable";
    usage.cost_estimate_error = `missing rate for model ${modelName ?? "unknown"}`;
    return;
  }

  const parts = [];
  addCostPart(parts, "input", usage.fresh_input_tokens ?? freshInputFromUsage(usage), rates.input);
  addCostPart(parts, "cached_input", usage.cache_read_tokens, rates.cached_input);
  addCostPart(parts, "output", usage.output_tokens, rates.output);
  addCostPart(parts, "reasoning_output", usage.reasoning_tokens, rates.reasoning_output);
  addCostPart(parts, "cache_write", usage.cache_write_tokens, rates.cache_write);

  usage.cost_breakdown = parts;
  const missing = parts.filter((part) => part.missing_rate && part.tokens > 0);
  if (missing.length > 0) {
    usage.cost_usd = null;
    usage.cost_source = "unavailable";
    usage.cost_estimate_error = `missing rates: ${missing.map((part) => part.kind).join(", ")}`;
    return;
  }

  usage.cost_usd = parts.reduce((sum, part) => sum + part.cost_usd, 0);
  usage.cost_source = "estimated";
  usage.cost_label = "api_equivalent_estimate";
  delete usage.cost_estimate_error;
}

function freshInputFromUsage(usage) {
  if (typeof usage.fresh_input_tokens === "number") return usage.fresh_input_tokens;
  if (typeof usage.input_tokens !== "number") return null;
  if (typeof usage.cache_read_tokens !== "number") return usage.input_tokens;
  return Math.max(0, usage.input_tokens - usage.cache_read_tokens);
}

function addCostPart(parts, kind, tokens, ratePerMillion) {
  const normalizedTokens = Number(tokens ?? 0);
  const hasRate = typeof ratePerMillion === "number";
  parts.push({
    kind,
    tokens: normalizedTokens,
    rate_per_1m_tokens: hasRate ? ratePerMillion : null,
    cost_usd: hasRate ? (normalizedTokens / 1_000_000) * ratePerMillion : 0,
    missing_rate: !hasRate,
  });
}

function rateCardMetadata(card, canonicalModel) {
  return {
    id: card.id ?? null,
    path: card.path,
    sha256: card.sha256,
    currency: card.currency ?? "USD",
    unit: card.unit ?? "per_1m_tokens",
    model: canonicalModel ?? null,
  };
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
