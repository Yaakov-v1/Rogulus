# Implementation handoff — 13 October 2026

## Delivery status

**MVP implemented and locally verified; user acceptance and real-model utility validation remain pending.**

Delivered a standalone TypeScript/Node 24 CLI, repository-local SQLite state, bounded approved guidance, temporary Claude hooks, explicit snapshot-bound checks, offline evidence extraction, manual capture, batch approval, retirement/reaffirmation, telemetry, tests and a ten-task paired pilot runner. No existing repository or Claude installation was modified to adopt the harness.

## Evidence

| Check | Result |
|---|---|
| `npm test` | **20 passed, 0 failed**, including integration subprocesses |
| `npm run typecheck` | Passed, strict TypeScript |
| `npm run benchmark -- docs/benchmark.json` | Passed, 20 baseline/wrapped pairs with 10,001 stored lessons |
| `npm run pilot -- --run --out docs/pilot.json` | **Blocked: Claude not authenticated**, no model calls made |
| `node --check test/pilot.mjs` and `test/pilot-cases.mjs` | Passed syntax checks |
| Independent review | Codex subagent inspected code; reported issues were fixed and re-reviewed; no remaining must-fix found |

The independent reviewer did not independently rerun the test suite. Sonnet/Haiku workflow execution was unavailable; local implementation was performed in this session and review used an available Codex subagent. This substitution was disclosed during work.

### Measured speed

Host: macOS, Node **v24.16.0**. See [machine-readable benchmark](benchmark.json).

- Lesson selection p95: **25.38 ms**.
- Added full fixture-session latency median: **280.36 ms**.
- Added full fixture-session latency p95: **392.52 ms**.
- Worst added full fixture-session latency: **415.37 ms**.
- Budget: **2,000 ms**.

These measurements include four hook subprocesses and their startups, telemetry, and selection from 10,000 active lessons. They use a simulated Claude adapter and establish local overhead only. Additional model inference time caused by injected context is not measured.

### Tested behavior

Tests cover approval/scope/expiry/rollback, 10k-entry context caps, idempotent ingestion, atomic superseding, fabricated evidence rejection, staged/unstaged/untracked invalidation, failed/timed-out/missing/interrupted checks, symlink identity, frozen context, no extraction during coding, bounded extraction failure, concurrent extraction claims, unavailable/locked SQLite, cumulative-budget skips, installation paths with spaces, native Ctrl+C preservation, and a supervisor whose input never completes.

## Limits and recovery

- The first adapter supports new local macOS/Linux Claude sessions. Windows, resumed sessions, cloud/worktree/background launches are not wrapped in this MVP.
- The two-second user-visible target passed the synthetic benchmark. Cumulative timing is best-effort; it does not promise an absolute wall-clock bound under OS stalls or overlapping hook events. A worker has an individual supervisor deadline.
- Real Claude inference, native-memory interactions, candidate quality, avoided rework, false-positive rate, and human review effort are **not validated** while authentication is absent.
- Approval is a human-operated CLI convention, not a security boundary against an already-authorized local shell agent.
- A learning attempt interrupted or rejected by the provider stays incomplete; no automatic spend retry occurs. Use manual evidence capture to recover.
- Disable by launching Claude directly or with `start --no-harness`. Retire a lesson to exclude it from subsequent sessions. Existing sessions keep their frozen context.

## Continue

1. Read [README](../README.md), build if needed, and initialize the desired Git repository explicitly.
2. Configure that repository's actual checks; no example command should be mistaken for a required project check.
3. Authenticate Claude with `claude auth login`.
4. Run the paired pilot described in [PILOT](PILOT.md), then annotate human corrections, escaped regressions and review effort.
5. Accept the MVP only after reviewing the result. Expand the harness only if real sessions demonstrate prevented repeat mistakes without unacceptable overhead.

No commit, publication, deployment, automation, or cross-repository promotion was performed.

## Enhancement 0.2.0 (2026-10-26)

Structured `tsc` findings, check-linked lessons, offline recurrence summaries, a bounded `review` view and measurement were added. Claude Code is the only coding agent; the Codex/manual adapter work was removed.

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | **29 passed, 0 failed** |
| `node --test test/adapter.test.mjs` x 5 | 12/12 pass each run, 0 flakes |
| `npm run benchmark` ([benchmark-0.2.0.json](benchmark-0.2.0.json)) | passed: 20 pairs, 10,001 lessons; selection p95 39.2 ms; added session p50 513.5 ms, p95 534.6 ms, worst 535.2 ms vs 2,000 ms target |
| `npm run pilot -- --run` | **not run** (owner decision); utility stays pending |

Post-review fixes: opening a database no longer runs DDL (the `lesson_checks` table is created lazily on first link, and reads treat a missing table as empty), `review` reports `recordedOutcome` plus `citedEvidence` instead of supporting/refuting buckets, is capped at 20 items with `total`/`truncated`, and looks each lesson up once. The fixture tests verify mechanics only (distinct-session recurrence, retry/duplicate non-independence, zero agent calls in aggregation/review, a labelled failure -> candidate -> approval -> next-session fixture). They are not utility evidence. The benchmark is synthetic and excludes model time.

