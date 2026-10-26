# Status — 2026-10-26

**Implementation verified; utility pending.** Build-prompt items 1-5 are implemented and tested (typecheck clean, 29/29 tests). No real-model pilot was run, so benefit is unmeasured.

## Decisions
- Claude Code is the only coding agent. The out-of-plan `agents.ts` (Codex/manual adapters) was removed.
- Real-model pilot skipped this run (owner decision); utility stays pending.

## Enhancement (package version 0.2.0)

| Build-prompt item | State |
|---|---|
| 1. Structured findings | Done. `findings.ts` parses `tsc` diagnostics (capped 20 findings / 16k chars) with fingerprint and `parserStatus`; parsed findings never turn a failure into success. |
| 2. Check-linked lessons | Done. `link-check` and `capture` `checkRefs` link a lesson to a real check run of its own session; explanatory only. Link table `lesson_checks` is additive and created lazily. |
| 3. Offline recurrence summaries | Done. `recurrence` groups repeated parsed failures; needs at least 2 distinct sessions; no model call. |
| 4. Review usability | Done. `review` returns `{total, truncated, items}` (max 20) with claim, cited evidence plus recorded outcome, checks, recurrence, conflicts, history. |
| 5. Measurement | Done. Synthetic benchmark below. |

## Verification (in `harness/`, Node v24.16.0)

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | **29/29 pass** |
| `node --test test/adapter.test.mjs` x 5 | 12/12 each, 0 flakes |
| `npm run benchmark` | passed; added session p50 513.5 ms, p95 534.6 ms, worst 535.2 ms (target 2,000 ms); selection p95 39.2 ms; 10,001 lessons; full JSON in `harness/docs/benchmark-0.2.0.json` |
| `npm pack` | `releases/lean-sdlc-harness-0.2.0.tgz` |

The earlier SIGTERM race in `sensors.ts verify()` stays fixed (listener registered before the `running` INSERT). The benchmark is synthetic and excludes model inference time.

## Review fixes applied
Opening a DB no longer runs DDL; `review` no longer buckets excerpts as supporting/refuting; review output is capped; per-link lesson table reads removed.

## Remaining gaps
- Real-model pilot (`npm run pilot -- --run`) not run; candidate quality, avoided rework and review effort unvalidated.
- Nothing committed.
