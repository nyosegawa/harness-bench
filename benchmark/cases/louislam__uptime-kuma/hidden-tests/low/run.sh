#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-ping-chart.js <<'JSEOF'
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("src/components/PingChart.vue", "utf8");
const match = source.match(/pushDatapoint\(datapoint, avgPingData, minPingData, maxPingData, downData, colorData\) \{([\s\S]*?)\n        \},\n        \/\/ get the average/);
assert.ok(match, "pushDatapoint method not found");

const pushDatapoint = new Function(
    "datapoint",
    "avgPingData",
    "minPingData",
    "maxPingData",
    "downData",
    "colorData",
    match[1],
);

function run(datapoint) {
    const avg = [];
    const min = [];
    const max = [];
    const down = [];
    const colors = [];
    pushDatapoint.call({
        $root: { unixToDateTime: () => "time" },
        getBarColorForDatapoint: () => "color",
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
