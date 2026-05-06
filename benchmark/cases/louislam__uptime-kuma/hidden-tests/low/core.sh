#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-ping-chart-core.js <<'JSEOF'
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("src/components/PingChart.vue", "utf8");

function methodSource(name) {
    const methodPattern = new RegExp(`${name}\\s*\\(`, "m");
    const match = methodPattern.exec(source);
    assert.notEqual(match, null, `${name} method not found`);
    const start = match.index;
    const paramsStart = source.indexOf("(", start);
    const paramsEnd = source.indexOf(")", paramsStart);
    const params = source.slice(paramsStart + 1, paramsEnd).split(",").map((param) => param.trim()).filter(Boolean);
    const open = source.indexOf("{", paramsEnd);
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
        const char = source[index];
        if (char === "{") depth += 1;
        if (char === "}") {
            depth -= 1;
            if (depth === 0) return { params, body: source.slice(open + 1, index) };
        }
    }
    throw new Error(`${name} method body not closed`);
}

function methodFunction(name, fallback) {
    try {
        const method = methodSource(name);
        return new Function(...method.params, method.body);
    } catch (error) {
        if (fallback) return fallback;
        throw error;
    }
}

const pushDatapoint = methodFunction("pushDatapoint");
const hasPingValue = methodFunction("hasPingValue", (ping) => ping !== null && ping !== undefined);
const hasValue = methodFunction("hasValue", (value) => value !== null && value !== undefined);
const hasRenderablePing = methodFunction("hasRenderablePing", (datapoint) =>
    datapoint.avgPing !== null && datapoint.avgPing !== undefined);
const getPingValue = methodFunction("getPingValue", (datapoint, key) => key ? datapoint[key] : datapoint);
const getPingChartValue = methodFunction("getPingChartValue", (datapoint, key) => key ? datapoint[key] : datapoint);
const getAverageDatapoint = methodFunction("getAverageDatapoint", (datapoints) => datapoints);

Object.assign(globalThis, {
    hasPingValue,
    hasValue,
    hasRenderablePing,
    getPingValue,
    getPingChartValue,
    getAverageDatapoint,
});

function run(datapoint) {
    const avg = [];
    const min = [];
    const max = [];
    const down = [];
    const colors = [];
    pushDatapoint.call({
        $root: { unixToDateTime: () => "time" },
        getBarColorForDatapoint: () => "color",
        hasPingValue,
        hasValue,
        hasRenderablePing,
        getPingValue,
        getPingChartValue,
        getAverageDatapoint,
    }, datapoint, avg, min, max, down, colors);
    return { avg, min, max };
}

const rendered = run({ timestamp: 1, up: 1, down: 0, avgPing: 0, minPing: 0, maxPing: 0 });
assert.equal(rendered.avg[0].y, 0);
assert.equal(rendered.min[0].y, 0);
assert.equal(rendered.max[0].y, 0);
JSEOF

node .benchmark-hidden-ping-chart-core.js
