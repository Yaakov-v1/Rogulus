# Status — 2026-10-26

**Implementation partial; utility pending.** The MVP works and is tested. An Oct 19 enhancement is half done. Its flaky-test regression is fixed (see below). No real-model pilot has run.

## MVP (Oct 13): done
Session wrapping around Claude Code, bounded guides (at most 5 lessons / 4,000 chars, frozen per session), check verification bound to a working-tree snapshot, offline extraction (one call per session, at most 3 candidates), human batch approval, retirement and 90-day re-review, and deadline/fail-open recovery.

## Oct 19 enhancement: in progress, uncommitted
Compared with `work/enhancement-baseline-2026-10-19/package/src`:

| Build-prompt item | State in `harness/src` |
|---|---|
| 1. Structured findings | **Started.** New `findings.ts` adds a `tsc` diagnostic parser, capped at 20 findings / 16k chars, with a check fingerprint and `parserStatus`. `sensors.ts` attaches findings and writes evidence in a transaction. `process.ts` tracks output truncation. `config.ts` accepts `parser: 'tsc'`. |
| 2. Check-linked lessons | **Started.** `store.ts` validates a lesson's `check:` evidence references through `checkObservation`. |
| 3. Offline recurrence summaries | Not started. |
| 4. Review usability | Not started. |
| 5. Measurement | Not started. |
| *(out of plan)* Multi-agent adapters | New `agents.ts` and config `agent.kind: claude/codex/manual`. Nothing imports it yet (`cli.ts` is unchanged). This goes beyond the build prompt's scope; decide whether to keep it. |

No new tests cover findings, check links or adapters yet.

## Verification run on 2026-10-26 (in `harness/`, Node v24.16.0)

| Command | Result |
|---|---|
| `npm ci` | ok, 0 vulnerabilities |
| `npm run typecheck` | **pass** (exit 0) |
| `npm test` | **19/20 pass, 1 fail** |
| baseline snapshot `npm test` (scratch copy) | 20/20 pass |
| `node --test test/adapter.test.mjs` × 5 | current: failed 4/5 · baseline: failed 0/5 |

Failing test, `test/adapter.test.mjs:98` "interrupted verification cannot return verified or execute remaining checks":

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
null !== 1          (at adapter.test.mjs:113 — exit code after SIGTERM)
```

**Root cause (fixed 2026-10-26).** `verify` persisted the `running` row before any signal listener existed. `runProcess` only registers `SIGTERM`/`SIGINT` after `spawn`, so a signal in that gap got Node's default action: the process was killed with exit `null`. Delaying the test's signal by 300 ms made it pass 6/6, which confirmed the race. The gap was there in the baseline too. The Oct 19 edits apparently widened it so it's hit most of the time; exactly how hasn't been measured. **Fix:** `src/sensors.ts` `verify` now registers its own listener before the INSERT, skips the remaining checks once interrupted, and removes the listener in `finally`.

After the fix: `npm run typecheck` passes · `npm test` **20/20** · `adapter.test.mjs` ×10: **0 failures**.

Not run: `npm run benchmark` and `npm run pilot` (the pilot needs live Claude auth, and the last recorded pilot was `blocked_authentication`). The last benchmark (baseline) had added-session p95 at 242.6 ms against a 2,000 ms target.

## Next
1. Decide what happens to `agents.ts` (keep, or drop as out of scope).
2. Continue [docs/build-prompt.md](docs/build-prompt.md), items 1–5, with tests, then the benchmark and the pilot.
