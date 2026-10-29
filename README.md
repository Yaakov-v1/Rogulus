# AIDLC

A lean, self-improving development harness for Claude Code, prepared for building a 3D roguelike in Unreal Engine 5. It is the [Harnestica](docs/harnestica-reference.md) engine plus a small set of rules for trusting less, staying legible, and routing work to the right model.

**Status:** fixture-tested (106/106), not yet run in a live session, and none of the Unreal commands have been run. See [STATUS.md](STATUS.md) before relying on it.

## Principles
- **Small.** One `CLAUDE.md` of at most 100 lines is the only always-loaded text. Everything else loads on demand or costs no context (hooks, path-scoped rules, subagents).
- **Scales with the task.** Tiny, small, medium and large tasks each get their own ritual. Large work gets a written plan, approval and an independent review.
- **Trust less.** Ranking, highest first: owner decisions and approved lessons, check output from this session, committed code that passes them, then anything an LLM wrote. Recalled context counts as about 77% true: a lead, never proof. Notes carry `verified <date> <check>` or `claimed`, and a `claimed` item gets one cheap re-check before anyone builds on it.
- **Stays legible.** On medium and larger work, the agent stops and re-asks when it touches a file the plan didn't name, adds a dependency, or takes an unlisted step. Each phase ends with a 3-line checkpoint: done, next, unsure.
- **Routes by model.** Haiku `explorer` finds and reads, Sonnet builds and reviews, Opus is for hard design only. Checks run in the main session.
- **Improves only with your yes.** The agent proposes lessons (hard cap 12, 90-day review). After about three recurrences of the same multi-step sequence, each cited from git history, `failures.jsonl` or lesson evidence, it can propose a skill. Nothing is created without approval.
- **Uses what you have.** CodeGraph (`codegraph_explore` when `.codegraph/` exists) and ponytail (if installed) are referenced, not reimplemented.

## Install
Run on the machine and project where the work happens:

```bash
./install.sh /path/to/repo                    # core harness
./install.sh /path/to/repo --profile unreal   # plus the Unreal profile
```

Safe to re-run. It never overwrites files you customised, including the Unreal `VERIFY.md` evidence log. Then:
1. Review `checks` in `.claude/harnestica.json`. They must be real commands that prove the project is healthy.
2. Open Claude Code in the repo once and accept the workspace trust dialog, or the harness stays inactive.
3. For Unreal: run `bash .claude/profiles/unreal/bootstrap-check.sh`, then work through `.claude/profiles/unreal/VERIFY.md`. Its commands stay inactive until you record that they ran.

Requires Node 18 or newer. Unreal Engine 5 and full Xcode (on Mac) need roughly 100 GB or more of free disk.

## Layout
| Path | What it is |
|---|---|
| `template/CLAUDE.md` | The always-loaded rules |
| `template/.claude/` | Hooks, check runner, `/lesson` skill, `explorer` and `reviewer` agents, Clean Code rules |
| `profiles/unreal/` | Path-scoped UE5 C++ rules, unverified check templates, `VERIFY.md`, machine check script |
| `install.sh`, `lib/install.mjs` | The installer |
| `tests/` | `npm test`: hooks, runner, installer, size budget |
| `docs/` | Design notes, research and the [Harnestica reference](docs/harnestica-reference.md) |

## Limits
- The tripwire and checkpoint are instructions; no hook enforces them yet.
- Moving an unverified Unreal check into the active config is manual, and nothing catches leftover `<placeholders>`.
- Unreal command paths and flags are from general knowledge and labelled `unverified`.
- Nothing measures yet whether it beats plain orchestration plus skills. A week of real use is the test.
