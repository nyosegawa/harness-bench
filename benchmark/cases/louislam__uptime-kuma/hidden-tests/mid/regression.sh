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

const { UptimeCalculator } = require("./server/uptime-calculator");

const calculator = new UptimeCalculator();
const minutelyKey = calculator.getMinutelyKey(dayjs.utc("2026-04-10T12:34:56Z"));
const hourlyKey = calculator.getHourlyKey(dayjs.utc("2026-04-10T12:34:56Z"));
const dailyKey = calculator.getDailyKey(dayjs.utc("2026-04-10T12:34:56Z"));

assert.ok(calculator.minutelyUptimeDataList[minutelyKey]);
assert.ok(calculator.hourlyUptimeDataList[hourlyKey]);
assert.ok(calculator.dailyUptimeDataList[dailyKey]);
assert.equal(calculator.minutelyUptimeDataList.length(), 1);
assert.equal(calculator.hourlyUptimeDataList.length(), 1);
assert.equal(calculator.dailyUptimeDataList.length(), 1);
JSEOF

node .benchmark-hidden-uptime-buckets-regression.js
