# Harnestica: efficient, auto-scaling development harness

An **efficient harness** is the smallest set of instructions and checks that keeps every session both fast and correct.
It **auto-scales** two ways: ritual grows with task size, and guidance grows from evidence, inside the fixed budget of this file (≤100 lines).
Native settings, permissions and memory stay as they are; this file adds process only.

## Project checks
The checks are the only source of _green_. Their commands live in `.claude/harnestica.json` (`checks`).
Run them all with `node .claude/hooks/harnestica-check.mjs`: one line per check, plus only the failing output. Don't pipe or filter it.
The Stop hook sends you back once when code changed and not every check has passed since, or when tests were deleted, skipped or lost assertions.

## 1. Size the task
Classify every request before acting. When unsure between two sizes, pick the larger one.

| Size | Signal | Ritual |
|---|---|---|
| Tiny | one file, obvious change, no behaviour change | edit → run the narrowest relevant check |
| Small | one area, clear intent, ≤3 files | read the touched code → edit → run checks |
| Medium | several files, a new behaviour, or unclear intent | state the plan in ≤5 bullets → get a yes → build → checks → self-review the diff |
| Large | cross-cutting, schema/API/security, or ≥1 day | written plan with risks → approval → slice into tracer bullets → checks per slice → `reviewer` subagent |

Escalate a size the moment the work reveals more (a failing unrelated test, a hidden caller, a migration).
When you de-escalate, say why in one line.
**Tripwire** (medium and up): stop and re-ask when you touch a file the approved plan did not name, add an abstraction or dependency, or take a step it does not list.
Unattended work needs a checkable done-condition and the plan's file list as its budget; without both, work in small approved steps.

## 2. Core loop
1. **Understand**: restate the goal in one line. Locate code with targeted search; read the symbols you will change and their callers.
2. **Plan** (medium and up): files, approach, the check that will prove it. Pick the simplest approach that works (ponytail, if installed). Ask only questions whose answer changes the work.
3. **Build**: the smallest change that meets the goal. The Clean Code rulebook (`.claude/rules/CLEAN-CODE.md`) loads when you touch code; every changed line meets its MUST rules. Keep the build _green_ between slices.
4. **Verify**: run the project checks. A bug fix starts _red_: reproduce it with a failing test first, then make it pass.
5. **Report**: what changed, the check output that proves it, and what is not done or not verified.

On medium and larger work, end each phase with a plain-words checkpoint of 3 lines: done / next / unsure. The owner should follow it in 10 seconds.

A step is done when its completion line holds:
- Understand: you can name every file you will touch.
- Plan: every file in it has a reason and the proving check is named.
- Build: the diff contains only goal-serving changes.
- Verify: each project check ran in this session and its result is quoted.

## 3. Evidence rules
- Claim _green_ only from a check you ran after the last edit. Quote the command and the result line.
- A failure, timeout, interruption, skipped check or unparseable output is _not verified_, never a pass.
- When a check cannot run (missing tool, credentials, network), report it as unverified with the reason.
- Fix the cause of a red check. Keep every existing test and assertion; strengthen them when behaviour changes.
- If a test looks wrong or conflicts with the goal, stop and report it; never edit a test just to make it pass.
- Separate "implemented" from "useful": tests prove behaviour, only real use proves value.
- Trust, highest first: owner decisions and approved lessons → output of checks run this session → committed code that passes them → anything an LLM wrote (notes, plans, summaries, handoffs, your own earlier claims). Treat recalled context as ~77% true: use it to find things, never as proof.
- Tag claims in notes and handoffs `verified <date> <check>` or `claimed`, and cite the file or test behind each. Re-check a `claimed` item with one cheap check before building on it. Procedures or flows you invent stay `claimed` until the owner or a check confirms them.

## 4. Context budget
- Read the parts that bear on the task: search first, then open the relevant ranges.
- Delegate wide sweeps (many files, docs, logs) to the `explorer` subagent; keep the main context for decisions and edits.
- Prefer the environment (`package.json`, configs, `--help`) over memory for facts it already states. If `.codegraph/` exists, use `codegraph_explore` before grep.
- Route by model: `explorer` (Haiku) finds and reads, and checks run in the main session; Sonnet builds and reviews; Opus only for hard design. Split work that mixes discovery and writing.
- Summarise long command output to the lines that matter.

## 5. Learning loop
A **lesson** is a one-line, evidence-backed correction that prevents a repeat mistake in this repo.

Propose a lesson when any of these happen:
- the owner corrects your approach, assumption or output;
- the same check fails the same way twice across sessions;
- a wrong assumption costs a rework.

The hooks flag a check that failed the same way in an earlier session; treat that flag as a trigger.

End your report with `LESSON? <rule> — evidence: <what happened, date> — scope: <path or repo>`, then run the `/lesson` skill to approve, merge or retire.
A candidate stays a candidate until the owner says yes. Hard cap: 12 lessons; 90-day re-review; the session-start hook reports overdue or over-cap lessons.
Apply a lesson only when the task touches its scope.
When the same multi-step sequence has recurred about three times, with each occasion cited from git history, `failures.jsonl` or lesson evidence, propose a skill with `/lesson`; never create one unprompted.

## 6. Lessons
Format: `- [YYYY-MM-DD · scope] rule — evidence`

<!-- Approved lessons go here, newest first, at most 12. -->
