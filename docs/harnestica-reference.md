# Harnestica reference (the engine inside the AIDLC)

The original Harnestica manual, kept for detail on hooks, checks and configuration. Start with the [AIDLC README](../README.md).

An efficient, auto-scaling development harness for Claude Code: one short CLAUDE.md, a few hooks, and a lesson loop that only grows when you approve it.

- **Efficient**: the smallest set of instructions and checks that keeps sessions both fast and correct.
- **Auto-scaling**, in two senses:
  1. The ritual scales with task size (tiny, small, medium, large). A one-line fix gets an edit and a check; a cross-cutting change gets a written plan, approval and an independent review.
  2. Guidance grows from evidence, as human-approved *lessons* inside a hard cap (12 lessons, 90-day re-review).
- **What it is not**: infrastructure autoscaling, a self-modifying system, or anything that adds a lesson without the owner's approval.

Current state: [STATUS.md](../STATUS.md). Read [Status and limitations](#status-and-limitations) before relying on it.

## Contents

- [How it works](#how-it-works)
- [Components](#components)
- [Requirements](#requirements)
- [Install](#install)
- [Day-to-day usage](#day-to-day-usage)
- [Clean Code rules](#clean-code-rules)
- [Lessons](#lessons)
- [Configuration](#configuration)
- [Upgrading and uninstalling](#upgrading-and-uninstalling)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Status and limitations](#status-and-limitations)
- [FAQ](#faq)
- [Origins](#origins)
- [Related projects](#related-projects-linked-not-copied)

## How it works

Only `CLAUDE.md` is loaded into every session, so it is kept at 100 lines or fewer (69 without lessons; `tests/budget.test.mjs` enforces the line cap and a byte budget). Everything else is placed where it costs no context until needed:

| Mechanism | Context cost |
|---|---|
| `CLAUDE.md` block | Always loaded; capped at 100 lines |
| Hooks (`harnestica.mjs`) | None unless a hook fires and prints a message |
| Check runner (`harnestica-check.mjs`) | One line per check; failing output only |
| `/lesson` skill, `explorer` and `reviewer` subagents | Loaded on demand (`explorer` also skips CLAUDE.md) |
| Clean Code rulebook (`.claude/rules/CLEAN-CODE.md`) | Path-scoped: Claude Code loads it only when Claude reads or edits a code file |

How this compares with Superpowers, Spec Kit, BMAD, GSD and others, and the evidence behind each choice: [docs/research/harness-comparison-2026-10.md](research/harness-comparison-2026-10.md).

The `CLAUDE.md` block tells Claude how to work:

| Section | What it does |
|---|---|
| Project checks | Points to the check commands in `.claude/harnestica.json` (the only source of "green") and the runner that runs them all. |
| 1. Size the task | Tiny / small / medium / large, each with its own ritual. When unsure, pick the larger size; escalate when the work reveals more. |
| 2. Core loop | Understand, plan, build, verify, report, each with a completion line. Build applies the Clean Code rulebook's MUST rules to every changed line. |
| 3. Evidence rules | Green only from checks run after the last edit. Failures, timeouts and skipped checks count as unverified. A test that looks wrong is reported, never edited to pass. |
| 4. Context budget | Targeted reads, `explorer` for wide sweeps, the environment over memory. |
| 5. Learning loop | `LESSON?` proposals; owner approval; 12-lesson cap; 90-day re-review. |
| 6. Lessons | The slot where approved lessons live, newest first. |

Task sizes:

| Size | Signal | Ritual |
|---|---|---|
| Tiny | one file, obvious change, no behaviour change | edit, run the narrowest relevant check |
| Small | one area, clear intent, 3 files or fewer | read the touched code, edit, run checks |
| Medium | several files, new behaviour, or unclear intent | plan in 5 bullets or fewer, get a yes, build, checks, self-review the diff |
| Large | cross-cutting, schema/API/security, or a day or more | written plan with risks, approval, tracer-bullet slices, checks per slice, `reviewer` subagent |

## Components

| Component | Path (in the target repo) | Role |
|---|---|---|
| CLAUDE.md block | `CLAUDE.md` (between `<!-- harnestica:start -->` and `<!-- harnestica:end -->`) | The always-loaded instructions and the Lessons slot. |
| Config | `.claude/harnestica.json` | `checks` (single source of truth for what "green" means), `lessonCap`, `reviewDays`, optional `docExtensions` (default `.md`, `.mdx`, `.txt`). |
| Hook script | `.claude/hooks/harnestica.mjs` and `.claude/hooks/harnestica/` | Dependency-free Node: a thin dispatcher by event plus one small module per concern (see below). |
| Check runner | `.claude/hooks/harnestica-check.mjs` | `node .claude/hooks/harnestica-check.mjs` runs every configured check in order and prints `✓ name (1.2s)` per pass, and for a failure `✗ name (exit 1, …): command` plus an excerpt (error-looking lines, then the last 15 lines). Exits 0 only when all passed, 2 when no checks are configured. |
| Hook wiring | `.claude/settings.json` | Registers the four hooks and allows the check runner and check commands. |
| Clean Code rulebook | `.claude/rules/CLEAN-CODE.md` | Rules with IDs for maintainability; see [Clean Code rules](#clean-code-rules). Its `paths:` frontmatter lists code extensions; add yours if they are missing. |
| `/lesson` skill | `.claude/skills/lesson/SKILL.md` | Propose, approve, merge, retire and re-review lessons. |
| `explorer` subagent | `.claude/agents/explorer.md` | Read-only codebase sweep (haiku, low effort, 20 turns, without CLAUDE.md). Returns `path:line` findings and what it did not find. |
| `reviewer` subagent | `.claude/agents/reviewer.md` | Read-only review of the current diff (sonnet). Runs the checks and reports only bugs, goal gaps, MUST-rule violations and missed reuse, each with a rule ID (`BUG` for correctness). An adequate change gets no findings. |
| Installer | `install.sh` and `lib/install.mjs` (this repo) | Copies and merges all of the above into a project. |

### Hooks

| Event | Argument | What it does |
|---|---|---|
| SessionStart | `start` | Audits the setup: warns if no checks are configured, if the Lessons slot is over the cap, if lessons are older than `reviewDays`, or if lesson lines are malformed. Only the Lessons section inside the harness block is read. |
| PostToolUse | `track` | Records code edits and passing check runs, in order, per session. |
| PostToolUseFailure | `failure` | Records failed check runs. If the same failure signature occurred in an earlier session, tells Claude to propose a `LESSON?` after fixing it. |
| Stop | `stop` | Blocks once when code was edited and not every configured check has **passed** since. It asks Claude to run the checks and quote the results, or, if the last check failed, to fix it or report the task as red. In the same pass, the **tamper sensor** compares the working tree with `HEAD` and blocks once if a test file gained a skip/only marker (`.skip(`, `.only(`, `xit(`, `@pytest.mark.skip`, `t.Skip(`, `@Disabled`), or if the test files together lost assertion lines (a deleted test file loses all of its own). Both messages go in one block. |

Behaviour worth knowing:

- The Stop hook respects `stop_hook_active` and gates each edit only once, so it cannot loop. The tamper sensor scans once per edit and reports each finding only once per session. Session start records the findings that already exist (your own uncommitted test changes), and those are never reported. The Stop hook records what it showed only after the `git` calls finish, so if a slow hook is killed, the gate is still due next time.
- Test files are code files (by extension) under `test/`, `tests/`, `__tests__/` or `spec/`, or named like `*.test.*`, `*.spec.*`, `*_test.*` or `test_*`, so fixtures and snapshots don't count. Assertions are counted net across all test files, including new untracked ones, so renaming or moving tests is not a loss. Each `git` call has a 3-second timeout. Without git or a first commit, the sensor stays silent; other `git` errors are logged.
- The runner merges stderr into stdout in order (POSIX shells), so the excerpt's tail is the real end of the output. `2>&1` after a check or the runner does not mask it.
- Edits to files whose extension is in `docExtensions` do not count as code edits, so doc-only changes do not trigger the gate.
- Hooks fail open. Any error is appended to `.claude/harnestica/state/errors.log` and the session continues.
- Per-session state is an append-only event log (`.claude/harnestica/state/sessions/<id>.jsonl`), so parallel tool calls never lose an update. The failure log keeps the last 1,000 entries. Both live in `.claude/harnestica/state/`, which the installer adds to `.gitignore`.
- A check counts as **passed** only when one shell segment is the check command (extra arguments allowed) and nothing after it can mask its exit code. Commands are split on top-level operators with quotes honoured. `cd app && npm test` passes; `npm test | tail`, `npm test || true`, `npm test; echo`, `npm test &`, `false || npm test`, `echo "npm test"` and `npm run lint:fix` do not. A trusted run of this project's check runner (`node .claude/hooks/harnestica-check.mjs`, through `$CLAUDE_PROJECT_DIR`, or by its absolute path) counts as a pass for every check. Another project's runner, or any other script with a similar name, does not.
- Besides Edit/Write tools, Bash commands that commonly change files (`sed -i`, `--write`/`--fix`, `git checkout|restore|apply|merge|rebase|pull|reset`, `mv`/`cp`/`rm`/`touch`/`patch`, `>` redirects other than `/dev/null`) count as edits.

## Requirements

- Claude Code
- Node.js 18 or newer on `PATH` (the hooks and the installer's merge step use it)
- bash
- A git repository to install into

## Install

Clone this repo, then run the installer against the project you want to equip:

```bash
./install.sh /path/to/repo
```

The installer is idempotent. Re-running it is safe.

| Target | What the installer does |
|---|---|
| `.claude/hooks/harnestica.mjs` and `.claude/hooks/harnestica/` | Always updated to this version. |
| `.claude/rules/CLEAN-CODE.md`, `.claude/skills/lesson/SKILL.md`, `.claude/agents/explorer.md`, `.claude/agents/reviewer.md` | Copied if absent; kept if you have customised them (it reports `kept`). |
| `.claude/harnestica.json` | Created once. Checks are detected from the target's `package.json` scripts `typecheck`, `lint` and `test`, using npm, pnpm (if `pnpm-lock.yaml` exists) or yarn (if `yarn.lock` exists). With no `package.json`, the list is empty and you add checks yourself. |
| `.claude/settings.json` | Merged: the hook entries are added once (skipped if any entry already contains `harnestica.mjs`), and `Bash(<check>:*)` allow entries are added for the check runner and each check. Other settings are untouched. |
| (all) | Every input is parsed before anything is written. An unparseable `settings.json` (for example one with comments) aborts the install with no changes. |
| `CLAUDE.md` | The harness block is appended between the markers; existing content is preserved. If the markers already exist, nothing changes. |
| `.gitignore` | `.claude/harnestica/state/` is added unless an existing rule already covers it. |

After installing:

1. Review the `checks` in `.claude/harnestica.json`. They must be the real commands that prove the project is healthy.
2. Commit the `.claude` files and `CLAUDE.md`.
3. Open Claude Code interactively in the repo once and accept the workspace trust dialog. Untrusted workspaces ignore the project `settings.json` permission entries (verified), and hooks are likely ignored too, so skipping this step leaves the harness inactive.

## Day-to-day usage

You work as usual; the harness shapes the session. An example:

1. You ask: "Rename the `timeout` option to `timeoutMs` across the API client."
2. Claude sizes it as medium (several files), states a plan in a few bullets and waits for your yes.
3. Claude edits the files. If it tries to finish without running the checks, the Stop hook blocks once and sends it back to run them.
4. Claude runs `node .claude/hooks/harnestica-check.mjs` (or `npm run typecheck` and `npm test` directly), and reports the commands and result lines. If a check cannot run, the report says "not verified" and why.
5. You correct something: "Our tests must go through `make test`, not `npm test`." Claude ends its report with a candidate:

```text
LESSON? Run tests through `make test` — evidence: owner correction, 2026-10-26 — scope: repo
```

6. You answer yes. Claude runs `/lesson`, which inserts the line in the Lessons slot. Next session, the rule is already loaded.

Large tasks additionally get a written plan with risks, tracer-bullet slices, and a pass by the read-only `reviewer` subagent. Wide searches go to `explorer` so the main context stays small.

## Clean Code rules

`.claude/rules/CLEAN-CODE.md` is a rulebook with IDs, adapted from Katharon. **MUST** rules are fixed before the work is final; **SHOULD** rules are fixed, or skipped with a one-line reason. The rules apply to the lines a change touches, so legacy code is cleaned only where you work.

| Group | Highlights |
|---|---|
| Naming (N1–N4) | Domain words, no filler names; a name never hides a side effect. |
| Functions (F1–F5) | **One function, one purpose** (MUST); about 20 lines; at most 3 parameters; no boolean flag parameters; guard clauses over nesting. |
| Conditions, constants, structure (S1–S6) | **At most 2 conditions per decision** (S3, MUST): a single `a ? b : c` is fine, a nested ternary is not; `if / else if / else` is fine, and a third condition becomes a lookup table, guard clauses or a named function; 3+ clauses in one condition get a name. **Name meaningful literals** (S2, MUST). One statement per line (S5). One concept per file (S4). Flat, obvious folders with no catch-all `utils` (S6). |
| Design (D1–D4) | No third copy, nothing built ahead of need, one reason to change, I/O at the edges. |
| Comments and errors (C1–C3, E1–E3) | Comments say why; never swallow an error; validate at the boundary. |
| Tests (T1–T7) | A failing test first for bugs; boundaries; never weaken a test; independent expected values. |
| Hygiene (H1–H4) | Smallest change; no secrets or unsafe string building; no unexplained dependencies; never silence a check. |

Add project-specific exceptions in the rulebook's **Project exceptions** section as `- <rule ID>: <exception> — <reason>`. Harnestica's own code follows the same rulebook.

## Lessons

A lesson is a one-line, evidence-backed correction that prevents a repeat mistake in this repo. It lives in section 6 of `CLAUDE.md`:

```text
- [YYYY-MM-DD · scope] rule — evidence
```

Lifecycle:

1. **Trigger**: the owner corrects an approach, assumption or output; the same check fails the same way twice across sessions (the hooks flag this); or a wrong assumption costs a rework.
2. **Candidate**: Claude ends its report with `LESSON? <rule> — evidence: <what happened, date> — scope: <path or repo>`. A candidate stays a candidate until the owner says yes.
3. **Approval**: on yes, the `/lesson` skill inserts the line at the top of the slot with today's date.
4. **Cap, merge, retire**: the slot holds at most 12 lessons. Overlapping lessons are merged; lessons the codebase now enforces (a lint rule, type or test), that are refuted, or that you retire are removed.
5. **Review**: lessons older than 90 days are flagged at session start. For each, `/lesson` asks: keep (re-date), rewrite, or retire.

Lessons apply only when a task touches their scope (`repo` or a repository-relative path prefix).

## Configuration

`.claude/harnestica.json`:

```json
{
  "version": 1,
  "checks": [
    { "name": "types", "command": "npm run typecheck" },
    { "name": "tests", "command": "npm test" }
  ],
  "lessonCap": 12,
  "reviewDays": 90
}
```

| Key | Meaning |
|---|---|
| `checks` | List of `{ name, command }`. A Bash command counts as running a check when one of its shell segments is that command (see the Hooks section for what counts as a pass). The Stop gate and the installer's allow entries both read this list. |
| `lessonCap` | Maximum lessons before the session-start audit complains (default 12). |
| `reviewDays` | Age in days after which a lesson needs re-review (default 90). |
| `docExtensions` | Optional. Extensions whose edits do not trigger the Stop gate (default `.md`, `.mdx`, `.txt`). |

If you add a check later, also add a matching `Bash(<command>:*)` entry to `permissions.allow` in `.claude/settings.json`, as the installer does for the checks it finds.

## Upgrading and uninstalling

**Upgrade.** Pull this repo and re-run the installer:

```bash
./install.sh /path/to/repo
```

This updates the hook script. Customised skill and agent files are kept. The `CLAUDE.md` block is also kept, so lessons and local edits survive. To take a new template version of the block, replace the text between the markers by hand with the contents of `template/CLAUDE.md`, and keep your lessons.

**Uninstall.** In the target repo:

1. Delete `.claude/hooks/harnestica.mjs`, `.claude/hooks/harnestica-check.mjs`, `.claude/hooks/harnestica/`, `.claude/harnestica.json`, `.claude/rules/CLEAN-CODE.md`, `.claude/skills/lesson/`, `.claude/agents/explorer.md`, `.claude/agents/reviewer.md` and `.claude/harnestica/`.
2. In `.claude/settings.json`, remove the hook entries whose command contains `harnestica.mjs` (and the `Bash(<check>:*)` allow entries if you no longer want them).
3. In `CLAUDE.md`, delete the block from `<!-- harnestica:start -->` to `<!-- harnestica:end -->`. Save any lessons you want to keep first.
4. Optionally remove `.claude/harnestica/state/` from `.gitignore`.

## Development

Run the tests from this repo's root:

```bash
npm test
```

This runs `node --test tests/*.test.mjs`: 98 tests (74 for the hooks, 6 for the check runner, 15 for the installer, 3 for the context budget), all passing. There are no runtime dependencies.

## Repository layout

| Path | What it is |
|---|---|
| `template/` | What gets installed: `CLAUDE.md` and `.claude/` (settings, config, hook script, `/lesson` skill, `explorer` and `reviewer` agents). |
| `install.sh` | The installer entry point (checks arguments and Node, then runs `lib/install.mjs`). |
| `lib/install.mjs` | The installer's plan-then-write logic. |
| `tests/` | `hooks.test.mjs`, `runner.test.mjs`, `install.test.mjs` and `budget.test.mjs`. |
| `package.json` | Defines `npm test`. |
| `STATUS.md` | Current decisions and what is not yet verified. |
| `docs/` | Research and design material: [build-prompt.md](build-prompt.md), [enhancement-review.md](enhancement-review.md), [design/](design/self-evolving-sdlc-harness.md), [research/](research/self-improving-harnesses.md), [harness comparison](research/harness-comparison-2026-10.md). |
| `archive/lean-sdlc-harness/` | Retired TypeScript CLI (0.2.0). Kept for reference; its ideas (evidence rules, bounded lessons, human approval) live on in the template. |
| `releases/` | `lean-sdlc-harness-0.1.0.tgz` and `0.2.0.tgz` of the retired CLI. |
| `work/` | Regression fixtures from the CLI's enhancement review. |

## Status and limitations

- Hook behaviour is verified with fixture tests only. It has not yet been exercised in a live Claude Code session; a headless run was blocked by an organisation auth policy.
- Hook overhead is one Node process start per matching tool call (about 50 ms measured in tests; not benchmarked).
- Utility is unproven until a trial in a real project. Whether Claude follows the sizing and `LESSON?` rules reliably is untested.
- Failure detection relies on `PostToolUseFailure` firing for nonzero Bash exits, as the Claude Code docs describe.
- Project settings, permissions and (likely) hooks only apply after the workspace is trusted.
- Path-scoped loading of the rulebook and `omitClaudeMd` on the explorer follow the Claude Code docs (v2.1.271+ for `omitClaudeMd`); neither has been observed in a live session. Older versions ignore the unknown field.
- The tamper sensor uses patterns, not a parser: an assertion moved into a helper counts as lost, and an unusual skip syntax is missed. Its block asks for a reason, so a false positive costs one turn.

## FAQ

**Why not just a CLAUDE.md?**
A CLAUDE.md can only ask. It cannot notice that code changed after the last check, or that the same check failed the same way last week. The hooks add that enforcement without adding context, and the lesson cap keeps the file from growing without bound.

**Why not the CLI?**
The earlier TypeScript CLI (`archive/lean-sdlc-harness/`) needed a separate tool, a database and a command to run. The harness is now files in the repo that Claude Code already reads and runs, with nothing extra to invoke. The CLI is retired, not deleted.

**How is this different from Claude Code's native memory?**
Native memory saves notes automatically. Harnestica lessons are written only after the owner approves, carry evidence and a scope, live in a version-controlled file shared with the team, and are capped and re-reviewed so stale rules get retired. It adds process on top of native settings, permissions and memory; it does not replace them.

## Origins

Everything in `docs/`, `archive/`, `releases/` and `work/` was **copied** on 2026-10-26. The originals are untouched.

| Original | Here | Date | Made by |
|---|---|---|---|
| `~/Documents/Codex/2026-10-13/pl/outputs/lean-sdlc-harness/` (without node_modules) | `archive/lean-sdlc-harness/` | Oct 13, edited Oct 19 | Codex (ChatGPT) |
| `…/pl/outputs/next-session-harness-prompt.md` | `docs/build-prompt.md` (paths rewritten) | Oct 19 | Codex |
| `…/pl/outputs/sdlc-harness-enhancement-review.md`, `enhancement-review-evidence.json` | `docs/` | Oct 19 | Codex |
| `…/pl/outputs/lean-sdlc-harness-0.1.0.tgz` | `releases/` | Oct 13 | Codex |
| `…/pl/work/enhancement-review-2026-10-19/`, `enhancement-baseline-2026-10-19/` | `work/` | Oct 19 | Codex |
| `~/Downloads/Self evolving SDLC harness.md` | `docs/design/self-evolving-sdlc-harness.md` | Oct 19 | research report |
| `~/Documents/Ariadne/Qadance-Aria/research_notes/Qadance Aria agentic workspace/self_improving_harness.md` | `docs/research/self-improving-harnesses.md` | Oct 6 | Claude research |
| `~/Downloads/Harness Engineering*`, `AI Dev Framework Workflow Synthesis.md`, `AI Web Development Orchestration Research.md` | `docs/research/harness-engineering/` | — | downloads |

Not copied: `pl/work/npm-cache` and `pl/work/package-smoke` (disposable).

## Related projects (linked, not copied)

- [Qadance-Aria](../../Ariadne/Qadance-Aria/): Claude + Codex multi-agent SDLC harness plan.
- [Astra SDLC](../../Ariadne/Astra%20SDLC/): Markdown SDLC framework for Codex/Astra.
- [Katharon (CleanCodeHarness)](../../Ariadne/CleanCodeHarness/): tool-neutral harness for coding agents with a Clean Code rule.
