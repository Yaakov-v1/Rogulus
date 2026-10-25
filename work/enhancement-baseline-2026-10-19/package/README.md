# Lean SDLC Harness

A standalone local CLI for **approved lessons, ordinary Claude coding, and explicit checks**. Learning runs only when you ask. No server, runtime npm dependencies, background daemon, or LLM review loop.

## Requirements and setup

- Node.js **24.x**, Git, macOS or Linux.
- Claude Code installed and authenticated for actual coding/extraction. The adapter was checked against local Claude Code **2.1.285** help and public hook/CLI contracts; automated integration tests use a fixture.
- Build tooling: pinned TypeScript and Node types in the lockfile.

```sh
npm ci
npm run build
node bin/lean-harness.mjs --help
```

From a target Git repository, call the package by absolute path (or install locally with `npm link` after building):

```sh
node /absolute/path/to/lean-sdlc-harness/bin/lean-harness.mjs init
```

`init` creates `.lean-harness/config.json`, a private SQLite database, and disposable hook telemetry. It adds ignore rules for database files and telemetry. Commit the config and ignore rules; keep the database local. It does not alter Claude settings, permissions, native memory, or project instructions.

In examples below, `lean-harness` means the installed command or the absolute Node invocation above.

## Configure checks once

Edit `.lean-harness/config.json`:

```json
{
  "version": 1,
  "agent": { "command": "claude", "args": [] },
  "checks": [
    { "name": "types", "command": "npm", "args": ["run", "typecheck"], "timeoutMs": 60000 },
    { "name": "tests", "command": "npm", "args": ["test"], "timeoutMs": 120000 }
  ],
  "learning": {
    "model": "haiku",
    "timeoutMs": 120000,
    "maxBudgetUsd": 1,
    "maxInputChars": 48000
  }
}
```

Use actual project commands. Commands execute as argument arrays without a shell. Shell operators are not interpreted. For a required shell script, configure the script executable explicitly. An empty check list **cannot verify a task**. Checks run sequentially; there is no caching or automatic retry.

## Daily workflow

```sh
lean-harness start --paths src/ui,src/forms -- "Fix keyboard handling in the dialog"
lean-harness verify --session <harness-session-id>
lean-harness status
```

`start` prints its harness session ID on stderr. Use that ID with `verify` to link check evidence to the session. Unlinked verification still works, but is not silently attributed to another concurrent session. Claude owns all coding iterations. Explicit agent arguments follow `--`, including normal permission options. The harness adds only temporary hook settings.

Guides inject at most **five approved lessons / 4,000 characters**, including the advisory header. Path scopes are literal repository-relative file or directory prefixes, not glob patterns. Path matches come first, then recently reviewed lessons. With no task paths, only repository-wide lessons are selected. The selected text is frozen for the session and reused after compaction; approval/retirement changes apply to subsequent sessions.

The first adapter supports **new local sessions**. Resume, worktree, background/cloud, bare/safe-mode and explicit `--settings` launches are rejected while wrapped because they can change context or hook ownership. Use native configuration files, or run ordinary Claude for those modes:

```sh
lean-harness start --no-harness -- --resume
# Running claude directly also completely disables the harness.
```

Native Ctrl+C cancellation is preserved for interactive coding. The wrapper does not add approval stages or launch additional models during coding.

## Process learning separately

```sh
lean-harness learn                 # process ended, unprocessed sessions
lean-harness learn --session <id>  # restrict to one ended session
lean-harness review
lean-harness approve <id1> <id2>
lean-harness reject <id3>
```

`learn` explicitly sends selected evidence to the configured Claude model. It makes at most **one extraction invocation per source session**, with a runtime/input/output/cost bound and no harness retries. The extraction call disables tools, customizations and MCP connections; it cannot edit the repository. No model runs in any coding hook. Normal coding model selection remains yours; the extraction model is separately configured.

Source transcripts stay where Claude wrote them. Extraction reads at most the final 256 KiB, takes user/assistant text (not private reasoning or tool-use payloads), and prioritizes recent excerpts and linked check results within the input cap. Each excerpt is capped at 6,000 characters. Common token/password patterns are redacted, but this is **not comprehensive secret detection**: inspect sensitive sessions before explicitly running `learn`.

Candidates are capped at three per session, schema-validated, and must cite existing evidence. They remain unapproved. Factual outcome (`unknown`, `supported`, `refuted`) is independent of lifecycle (`candidate`, `active`, `retired`). Evidence references establish provenance, not the truth of an LLM's interpretation. Human review must check whether the claimed lesson follows from the excerpt; passing unrelated tests does not establish that.

Review prints cited excerpts and all overlapping active/candidate guidance together. It does not claim semantic contradiction detection. To replace an existing lesson atomically:

```sh
lean-harness approve <new-candidate-id> --supersedes <old-active-id>
lean-harness retire <active-id>       # rollback for future sessions
lean-harness reaffirm <active-id>     # re-review and renew for 90 days
lean-harness history <id>
```

Lessons older than 90 days since review are excluded until reaffirmed. Refuted or evidence-free lessons cannot be activated. Rejected and superseded versions remain in history. There is no approve-all command. Approval commands are intended for the human operator; this single-user CLI does not implement an authentication boundary preventing an already-authorized shell agent from calling them.

### Manual capture and recovery

For a useful correction without model extraction, save a JSON file:

```json
{
  "statement": "Preserve valid zero quantities; use nullish defaults.",
  "scope": ["src/cart"],
  "outcome": "supported",
  "evidenceText": "User correction: zero is a valid quantity; the fallback must only apply to null or undefined."
}
```

```sh
lean-harness capture --file correction.json
lean-harness review
```

An optional `sessionId` links the capture to an existing session. Identical imports are idempotent. Imports are still candidates, never automatically active.

Unavailable extraction leaves a session `incomplete`; a process killed mid-extraction can remain `running`. Neither state is retried automatically, preventing repeated spend. Inspect evidence and use manual capture to recover. Sessions interrupted before transcript registration may likewise need manual capture. Corrupt/unavailable storage causes `start` to warn and launch ordinary Claude. Verification commands fail rather than claiming success. Do not copy databases between repositories or delete a live WAL file to recover storage.

## Verification meaning

Checks are bound to a hash of HEAD, the Git index, tracked and nonignored untracked contents, modes, symlink targets, and harness config. A changed snapshot during checking is reported as `changed`; subsequent edits make a prior success `stale`. Timed-out, failed, interrupted, missing or unconfigured checks never count as verified. Interrupted runs retain `not_run` for remaining checks. Submodules/special files that cannot be safely snapshotted produce incomplete verification.

Ignored build artifacts, external services, toolchain/environment changes, and edits made then restored during a check are not tracked by this snapshot. Re-run required checks when those inputs change. This CLI reports evidence; it does not merge, deploy, or enforce remote branch protection.

## Speed and measurements

```sh
lean-harness metrics
npm run benchmark -- docs/benchmark.json
```

Hook workers have a **450 ms supervisor deadline**, plus up to 25 ms for telemetry flushing; native Claude hook timeout is a further fallback. Optional work is skipped when recorded per-turn processing approaches two seconds. No transcripts are scanned inside hooks.

Supervisor metrics include worker startup, SQLite work, commit/close, and worker exit. Timeout/error outcomes are recorded in a separate disposable JSONL telemetry spool even when SQLite is locked. Metrics exclude supervisor Node startup and final telemetry append. A missing/unwritable telemetry directory can lose measurements; do not treat absent records as zero latency. Timers cannot guarantee wall time under arbitrary OS scheduling stalls, and overlapping hook invocations are not globally serialized. The **two-second end-user latency target is checked by the external wall-clock benchmark**, not asserted from internal timing alone.

The benchmark uses 10,000 active lessons and measures full fixture sessions with four hooks versus ordinary fixture sessions, including Node startup and telemetry. It proves local overhead and context bounds, not model utility.

## Validation and pilot

```sh
npm test
npm run typecheck
npm run benchmark -- docs/benchmark.json
npm run pilot -- --out docs/pilot.json
```

The pilot defaults to a dry run. It contains ten paired small-edit, recurring-defect and multi-file tasks, with independent deterministic assertions and a fixed model. To run the 20 actual coding calls after authenticating Claude:

```sh
npm run pilot -- --run --model sonnet --out docs/pilot.json
```

Each call has a $2 configured API budget cap; actual billing depends on your Claude authentication/provider. It uses temporary repositories, alternates baseline/treatment order, and retains those repositories for inspection. The treatment has authored, explicitly seeded experimental lessons, not automatically learned production rules. Both sides run the same assertions; human corrections, wider regressions, and review effort remain null until annotated. Toy-task results cannot establish production benefit. See `docs/PILOT.md` for the go/no-go rule.

## Internal contracts

- **Guides:** `(store, taskPaths, now) → {context, lessonIds}`. No model calls.
- **Factory:** repository/config + agent arguments → inherited-terminal agent process and session exit status. Hooks record transcript references and frozen context only.
- **Sensors:** configured argument-array commands → bounded outputs, check statuses, durations, before/after snapshot identities.
- **Learning:** ended session evidence → validated candidates; explicit review transaction → activation/retirement history.

Storage schema version 1 lives in `src/store.ts`; extraction JSON Schema lives in `src/learning.ts`. These are ordinary modules, with no third-party plugin API or event bus. Cross-repository learning, autonomous promotion, self-modifying code, LLM reviews, check caching, and additional agent adapters are intentionally deferred.

Reference contracts: [Claude hooks](https://code.claude.com/docs/en/hooks), [Claude programmatic CLI](https://code.claude.com/docs/en/headless), [Node 24 SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).
