#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  npm ci --omit=dev --ignore-scripts --no-audit
fi

cat > .benchmark-hidden-uptime-buckets-regression.js <<'JSEOF'
process.env.TEST_BACKEND = "1";

const assert = require("node:assert/strict");
const dayjs = require("dayjs");
dayjs.extend(require("dayjs/plugin/utc"));

const { UP } = require("./src/util");
const { UptimeCalculator } = require("./server/uptime-calculator");

(async () => {
    const calculator = new UptimeCalculator();
    const timestamp = dayjs.utc("2026-04-10T12:34:56Z");

    await calculator.update(UP, 42, timestamp);

    const minutelyKey = calculator.getMinutelyKey(timestamp, false);
    const hourlyKey = calculator.getHourlyKey(timestamp, false);
    const dailyKey = calculator.getDailyKey(timestamp, false);

    assert.ok(calculator.minutelyUptimeDataList[minutelyKey]);
    assert.ok(calculator.hourlyUptimeDataList[hourlyKey]);
    assert.ok(calculator.dailyUptimeDataList[dailyKey]);
    assert.equal(calculator.minutelyUptimeDataList[minutelyKey].up, 1);
    assert.equal(calculator.hourlyUptimeDataList[hourlyKey].up, 1);
    assert.equal(calculator.dailyUptimeDataList[dailyKey].up, 1);
})();
JSEOF

node .benchmark-hidden-uptime-buckets-regression.js
