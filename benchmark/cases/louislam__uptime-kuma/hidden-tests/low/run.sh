#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-ping-chart.js <<'JSEOF'
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
    assert.notEqual(paramsStart, -1, `${name} parameter list not found`);
    assert.notEqual(paramsEnd, -1, `${name} parameter list not closed`);
    const params = source.slice(paramsStart + 1, paramsEnd)
        .split(",")
        .map((param) => param.trim())
        .filter(Boolean);
    assert.notEqual(start, -1, `${name} method not found`);
    const open = source.indexOf("{", paramsEnd);
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
        const char = source[index];
        if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return { params, body: source.slice(open + 1, index) };
            }
        }
    }
    throw new Error(`${name} method body not closed`);
}

function methodFunction(name, fallback) {
    try {
        const method = methodSource(name);
        return new Function(...method.params, method.body);
    } catch (error) {
        if (fallback) {
            return fallback;
        }
        throw error;
    }
}

const pushDatapoint = methodFunction("pushDatapoint");
const hasPingValue = methodFunction("hasPingValue", (ping) => ping !== null && ping !== undefined);
const hasValue = methodFunction("hasValue", (value) => value !== null && value !== undefined);

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
    }, datapoint, avg, min, max, down, colors);
    return { avg, min, max };
}

let rendered = run({ timestamp: 1, up: 1, down: 0, avgPing: 0, minPing: 0, maxPing: 0 });
assert.equal(rendered.avg[0].y, 0);
assert.equal(rendered.min[0].y, 0);
assert.equal(rendered.max[0].y, 0);

rendered = run({ timestamp: 1, up: 1, down: 0, avgPing: null, minPing: null, maxPing: null });
assert.equal(rendered.avg[0].y, null);

rendered = run({ timestamp: 1, up: 0, down: 1, avgPing: 5, minPing: 4, maxPing: 6 });
assert.equal(rendered.avg[0].y, null);
JSEOF

node .benchmark-hidden-ping-chart.js
