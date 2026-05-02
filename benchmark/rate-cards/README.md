# Rate Cards

Rate cards are JSON files used to estimate API-equivalent costs when a harness does not report dollar cost directly.

Claude Code reports `total_cost_usd`, so the runner keeps that as `cost_source: reported`.

Codex and Cursor do not currently expose dollar cost in the observed CLI outputs. For those harnesses, the runner can estimate cost from token usage if a rate card is provided.

Use:

```bash
node scripts/run-case.mjs ... --rateCard benchmark/rate-cards/example-2026-05-03.json
```

Only publish estimated costs after filling in real rates and recording the rate-card id/hash.

Cursor estimates are API-equivalent estimates. They may not match Cursor subscription billing or credit accounting.
