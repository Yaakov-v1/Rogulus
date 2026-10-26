# Status — 2026-10-26

**Full harness built and fixture-tested (98/98). Compared with ~16 popular harnesses; the top gaps are fixed. Not yet exercised in a live Claude Code session or a real project.**

## Decisions
- The harness is CLAUDE.md (≤100 lines, always loaded) plus on-demand parts: hooks, the check runner, the `/lesson` skill, `explorer`/`reviewer` subagents, and `install.sh`.
- The Stop hook blocks **once** when code changed and not every check has passed since, and once when tests were deleted, skipped or lost assertions.
- The Clean Code rulebook is path-scoped, so sessions that touch no code don't load it.
- Per-repo install, so lessons stay project-specific. Claude Code is the only coding agent.
- The TypeScript CLI is retired to `archive/lean-sdlc-harness/` (0.2.0, 29/29 tests).
- Harness comparison ([docs/research/harness-comparison-2026-10.md](docs/research/harness-comparison-2026-10.md)): the owner chose the report plus the top fixes. Plugin packaging, hook-latency work and a with/without eval are deferred.

## Components
| Part | Path | State |
|---|---|---|
| Instructions | `template/CLAUDE.md` | 69 lines without lessons, ≤81 with the slot full; byte budget in `tests/budget.test.mjs` |
| Checks config | `template/.claude/harnestica.json` | single source of truth for check commands |
| Hooks | `template/.claude/hooks/harnestica.mjs` (dispatcher) + `hooks/harnestica/` (modules) + `settings.json` | SessionStart audit, edit/check tracking, repeat-failure flag, Stop gate, test-tamper sensor; fail-open |
| Check runner | `template/.claude/hooks/harnestica-check.mjs` + `hooks/harnestica/runner.mjs` | runs all checks; one line per pass, excerpt per failure; counts as a pass for every check |
| Clean Code rulebook | `template/.claude/rules/CLEAN-CODE.md` | 36 rules with IDs; `paths:`-scoped to code files; applied by Build and (MUST rules) by the reviewer |
| Lesson skill | `template/.claude/skills/lesson/SKILL.md` | durable bar, propose / approve / merge / retire / review, 12-cap |
| Subagents | `template/.claude/agents/{explorer,reviewer}.md` | Haiku sweep (low effort, 20 turns, no CLAUDE.md); Sonnet review limited to bugs, goal gaps, MUST rules and reuse |
| Installer | `install.sh` + `lib/install.mjs` | idempotent; merges settings, appends the CLAUDE.md block between markers, detects package.json checks, allows the runner |

## Verification
- `npm test`: **98/98 pass** (74 hook, 6 runner, 15 installer, 3 budget). New this round:
  - the runner: pass and fail exit codes, a capped excerpt, running from the project root, no checks counting as no pass;
  - a runner run clearing the gate, with masked runner runs not clearing it;
  - each tamper type, renames, moves into untracked files, fixtures, the session-start baseline, per-finding dedupe, a combined gate-and-tamper block, and silence without git;
  - the runner allow entry;
  - the budget assertions.
- An independent review of this round found 4 medium and 7 low defects. All are fixed with tests:
  - Gate state was written before the slow `git` work.
  - Renamed tests were flagged.
  - Owner changes made before the session were blamed.
  - Look-alike runner paths cleared the gate.
  - Quoted paths, fixtures, unlogged `git` errors, `2>&1` and stderr order were wrong.
  - Findings were deduped as a set rather than one by one.
- Earlier reviews found 14 defects, all fixed.
- **Not verified live.** A headless `claude -p` run was refused (`oauth_not_allowed_for_organization`). Claude Code also ignores project `settings.json` permissions in a workspace that hasn't been trusted, so open the repo interactively once after installing.
- Hook cost: one Node start per tool call, about 50 ms in tests (not benchmarked). The tamper sensor adds a `git diff` and a `git ls-files` (3 s timeout each) at session start and per Stop that follows a new edit.

## Next
1. Install into one real project and accept the trust dialog. Then confirm three things in a live session:
   - `/context` shows no CLEAN-CODE rule before code is touched, and shows it after.
   - The Stop gate and the tamper sensor fire.
   - The runner output stays compact.
2. Use it for a week. Then count the missed or noisy `LESSON?` proposals, the extra turns the Stop gate causes, and the tamper false positives.
3. Then decide on the deferred items in the comparison report: a with/without eval, hook latency, and plugin packaging.
