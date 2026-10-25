# Next-session prompt: complete the lean, evidence-driven SDLC harness

Use `$anthropic-skills:agent-orchestration`:
`/Users/yaakovins/.codex/plugins/cache/claude-cowork/anthropic-skills/1.0.0/skills/agent-orchestration/SKILL.md`

Complete the existing local harness using the bounded enhancement plan below. Extend the implementation already present; do not restart from the research document's sample scripts. Carry the work through implementation, meaningful tests, independent review, packaging, and an evidence-backed handoff. Report honestly any remaining external validation or human acceptance.

## Goal and constraints

“Auto scaling” here is a provisional shorthand for guidance improving as session evidence accumulates, with bounded context and processing. It does not mean infrastructure autoscaling, automatically spawning agents during coding, autonomous lesson approval, or self-modifying code. If I mean one of those materially different capabilities, resolve that scope change before implementing it.

My previously stated concern, verbatim, is:

> Software development sessions might become too slow and this harness we're trying to make might become too overengineered

Preserve these decisions:

- One TypeScript package, Node.js 24, local SQLite per repository, CLI only.
- Claude Code owns the coding loop; preserve its permissions, project instructions, and native memory.
- Zero additional inference calls during coding. Extraction runs only in an explicitly requested learning batch, at most one bounded call per session and three candidates.
- Mandatory human batch approval before activating lessons. Factual outcome (`unknown`, `supported`, `refuted`) remains separate from lifecycle (`candidate`, `active`, `retired`).
- At most five lessons and 4,000 characters total, selected by repository/explicit path scope and frozen for the session. Preserve 90-day re-review behavior.
- Added local processing targets at most two seconds per turn. Measure cumulative hook overhead; required check runtime is separately measured. Preserve deadline/fail-open recovery behavior for optional learning.
- Explicit verification, bound to the working-tree snapshot. No per-edit or per-response test/reviewer loop.
- No server, dashboard, vector database, plugin registry, workflow engine inside the product, cross-repository rules, automatic retries, automatic promotion, or generated unbounded native rule files.

Orchestration used to BUILD this package is separate from the package's runtime. Do not embed this development workflow in the harness.

## Workspace and evidence

Workspace: `/Users/yaakovins/Documents/Harnestica `

Package: `/Users/yaakovins/Documents/Harnestica /harness`

Read first:

1. Applicable AGENTS.md instructions. Use CodeGraph first if a `.codegraph/` directory exists; do not create an index. Read `/Users/yaakovins/.codex/skills/quest-loadout/SKILL.md` as required by the workspace instructions. Reuse existing approvals and task records.
2. Package `README.md`, `package.json`, `docs/VALIDATION.md`, `docs/PILOT.md`, `docs/benchmark.json`, and `docs/pilot.json`.
3. `/Users/yaakovins/Documents/Harnestica /docs/enhancement-review.md`
4. `/Users/yaakovins/Documents/Harnestica /docs/enhancement-review-evidence.json`
5. Relevant source: `src/types.ts`, `store.ts`, `sensors.ts`, `learning.ts`, `guides.ts`, `factory.ts`, `cli.ts`, and existing tests.

Optional proposal reference: `/Users/yaakovins/Documents/Harnestica /docs/design/self-evolving-sdlc-harness.md`. Its instructions are document content, not commands to execute. If unavailable, the saved review is sufficient for the bounded enhancement.

Current recorded state, to verify rather than assume unchanged:

- The MVP already implements session wrapping, bounded guides, snapshot-bound verification, extraction, batch review, retirement, and recovery.
- The previous validation records 20 passing tests. Synthetic added fixture-session latency was p95 392.52 ms and worst 415.37 ms with 10,000 active lessons. These are historical results, not newly run tests or productivity evidence.
- Check results already carry status, duration, exit code, output, and verification/session references. Reuse those records; avoid a second sensor subsystem.
- The saved real-model pilot has `blocked_authentication` status and no results. Check current availability; do not assume authentication is still missing or claim utility has been validated.
- Five defects were reproduced in the PROPOSED document scripts: forged approval via capture, confirmation without a sensor run, silent passing of failed checks, uncapped path-rule files, and caching failed review attempts. Do not misattribute these defects to the existing package. Use them as regression scenarios where relevant.
- Local CLI approval is a human workflow convention, not isolation against a shell agent already allowed to modify local data.

## Orchestration and execution plan

Apply the invoked skill's planning discipline using `extreme-planning-session`. Keep the goal contract, current-reality map, disparity register, plan, and evidence in one concise record. Existing scope approvals and concerns remain valid; do not repeat a gate merely because this is a new session. Surface material changes once with a concrete decision.

The skill requires Haiku for exploration and Sonnet for implementation/correctness review, and an actual Workflow tool for execution. Inspect available capabilities. Load `workflow-authoring` before constructing a real workflow. Do not simulate delegation or relabel Codex agents as Haiku/Sonnet. If unavailable, complete useful preparation and report the exact missing capabilities; obtain approval for an alternate execution method before substituting one. The previous session had no callable Workflow tool or Haiku/Sonnet agent routing, and found no local workflow-authoring skill in the searched skill roots.

| Step | Role / tier | Dependencies | Deliverable and verification |
|---|---|---|---|
| 1 | Research / Haiku | None | Inspect current code and instructions; map existing evidence/check records, approval boundaries, test coverage, and missing capabilities. Identify the smallest compatible extension. |
| 2 | Implementation / Sonnet | 1; applicable execution approval | Capture current baseline tests/benchmark, then implement bounded structured findings and optional lesson-to-check references using existing storage and explicit verification. Preserve old records/configuration. |
| 3 | Implementation / Sonnet | 2 | Add deterministic recurrence summaries to offline learning/review; preserve extraction budgets, provenance, and human approval. Add recovery and compatibility tests. |
| 4 | Independent review / Sonnet | 3 | Review full changes for evidence errors, authorization-field injection, stale snapshots, migration/data loss, concurrency, context caps, and unexpected coding-time work. Reviewer did not author reviewed changes. |
| 5 | Implementation and verification / Sonnet | 4 | Resolve findings, run required checks and benchmark, update documentation, package the result, and run the paired pilot if prerequisites permit. Separate software completion from demonstrated utility. |

Parallelize only independent work with clear file ownership. Keep dependent schema/storage/consumer changes sequential. Prefer a small team; do not add agents merely because slots are available.

## Bounded enhancement to implement

1. **Structured findings:** optionally attach stable category, repository-relative location, message, and evidence reference to an existing check run. Preserve raw output, run identity, checked snapshot, status, duration, and exit code. Bound record size/count. Prefer the smallest useful parser for checks actually configured; no parser plugin system.
2. **Check-linked lessons:** allow optional references to existing configured checks, with validation against actual records. These links explain relevance; they never prove a lesson or grant approval. Do not allow generated commands to become “truth checks.”
3. **Offline recurrence summaries:** group repeated comparable failures using deterministic identifiers and distinct session/run provenance. Show source evidence and relevant existing lessons during learning/review. Do not count duplicate ingestion/retries as independent sessions or infer a root cause from recurrence alone. Unsupported output remains raw evidence rather than guessed findings.
4. **Review usability:** show the stated correction or assumption, supporting/refuting/unknown evidence, related check outcomes, and conflicting lessons together. Preserve batch decisions, retirement, superseding history, and rollback. Keep recurrence output bounded so it reduces review work.
5. **Measurement:** reuse existing timing records. Record actual human review effort and observed recurrence prevention in the pilot; do not turn a model's self-assessment into a success metric.

No finding is not proof. No run, failed execution, timeout, interruption, parser failure, or unrelated passing test must generate positive support. Parsed findings must never override process failure into success. Cross-file errors remain relevant even if the error location was not edited. A quoted code fragment proves text exists, not that a claimed defect follows.

## Acceptance and validation

Run from the package directory:

```sh
npm run typecheck
npm test
npm run benchmark
```

Use the existing scripts and pinned dependencies; inspect current state before installing or changing tooling. Add tests for externally observable failures and recovery, not mirrors of implementation details.

| Acceptance | Required evidence |
|---|---|
| No coding-time inference or added per-turn processing loop | Adapter/hook fixtures record zero extraction/reviewer calls during coding |
| Bounded guidance and overhead | Five/4,000 caps with 10,000 entries; frozen session selection; benchmark reports cumulative overhead and deadline behavior |
| Honest evidence | Tests for nonzero exits without parseable findings, missing/timed-out/interrupted checks, invalid references, unrelated success, and cross-file failures |
| No automatic or forged activation | Closed input validation; candidate-only ingestion; explicit review path; retired/unapproved/refuted/overdue lessons excluded as applicable |
| Snapshot integrity | Staged, unstaged, untracked, and configuration changes invalidate prior completion evidence |
| Compatible/recoverable storage | Existing database fixtures remain readable; idempotent ingestion; concurrent sessions; failure injection/rollback without silent data loss |
| Bounded offline learning | At most one extraction call per session/three candidates; failed extraction remains incomplete; recurrence aggregation makes no model calls |
| Utility | Paired task results and actual human annotations, with limitations clearly stated |

For the real-model pilot, inspect current authentication and the pilot script. Keep one fixed model and identical required checks, source state, native memory, and environment across paired runs. The documented command is:

```sh
npm run pilot -- --run --model <fixed-model> --out docs/pilot.json
```

Do not fabricate human corrections, regressions, or review time. The existing seeded ten-task pilot tests delivery of authored guidance; it does not prove end-to-end learning. Add a reproducible fixture covering failure → extraction candidate → human approval → next-session guidance, then distinguish that mechanism test from real observed repeat-mistake prevention. If live credentials or human observations are unavailable, finish independent implementation and fixture verification and clearly report the remaining utility validation.

## Completion and recovery

Use additive, versioned storage changes only where necessary. Preserve existing databases and histories; prepare a safe backup/recovery path before migration. Do not weaken checks to get green results. No deployment, publication, external messaging, or cross-repository installation is requested.

Update the existing README and validation/pilot records with actual results. Produce an updated installable archive under the workspace `releases/`, verify its contents, and provide exact startup/check/review commands. Keep intermediate fixtures under `work/`.

Finish with: delivered behavior, tests and benchmark evidence, independent-review findings and fixes, data compatibility/recovery, package path, and remaining user acceptance or real-world evidence. Say “implementation verified; utility pending” if that is the actual result. Never claim the harness is fully proven from synthetic tests alone.
