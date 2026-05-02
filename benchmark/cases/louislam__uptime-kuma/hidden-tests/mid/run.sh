#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  npm ci --omit=dev --ignore-scripts --no-audit
fi

cat > .benchmark-hidden-uptime-buckets.js <<'JSEOF'
process.env.TEST_BACKEND = "1";

const assert = require("node:assert/strict");
const dayjs = require("dayjs");
dayjs.extend(require("dayjs/plugin/utc"));

const { UptimeCalculator } = require("./server/uptime-calculator");

const calculator = new UptimeCalculator();
calculator.getMinutelyKey(dayjs.utc("2026-04-10T12:34:56Z"));
calculator.getHourlyKey(dayjs.utc("2026-04-10T12:34:56Z"));
calculator.getDailyKey(dayjs.utc("2026-04-10T12:34:56Z"));

const minutelyCleanupKey = calculator.getMinutelyKey(dayjs.utc("2026-04-09T12:34:56Z"), false);
const hourlyCleanupKey = calculator.getHourlyKey(dayjs.utc("2026-03-11T12:34:56Z"), false);
const dailyCleanupKey = calculator.getDailyKey(dayjs.utc("2025-04-10T12:34:56Z"), false);

assert.equal(calculator.minutelyUptimeDataList.length(), 1);
assert.equal(calculator.hourlyUptimeDataList.length(), 1);
assert.equal(calculator.dailyUptimeDataList.length(), 1);
assert.equal(calculator.minutelyUptimeDataList[minutelyCleanupKey], undefined);
assert.equal(calculator.hourlyUptimeDataList[hourlyCleanupKey], undefined);
assert.equal(calculator.dailyUptimeDataList[dailyCleanupKey], undefined);
JSEOF

node .benchmark-hidden-uptime-buckets.js
