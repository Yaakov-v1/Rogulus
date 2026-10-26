# Status — 2026-10-26

**Full harness built and fixture-tested (64/64). Not yet exercised in a live Claude Code session or a real project.**

## Decisions
- The harness is CLAUDE.md (≤100 lines, always loaded) plus on-demand parts: hooks, the `/lesson` skill, `explorer`/`reviewer` subagents, and `install.sh`.
- The Stop hook blocks **once** when code changed and not every check has passed since.
- Per-repo install, so lessons stay project-specific. Claude Code is the only coding agent.
- The TypeScript CLI is retired to `archive/lean-sdlc-harness/` (0.2.0, 29/29 tests).

## Components
| Part | Path | State |
|---|---|---|
| Instructions | `template/CLAUDE.md` | 67 lines without lessons, ≤79 with the slot full |
| Checks config | `template/.claude/harnestica.json` | single source of truth for check commands |
| Hooks | `template/.claude/hooks/harnestica.mjs` (dispatcher) + `hooks/harnestica/` (modules) + `settings.json` | SessionStart audit, edit/check tracking, repeat-failure flag, Stop gate; fail-open |
| Clean Code rulebook | `template/.claude/rules/CLEAN-CODE.md` | 36 rules with IDs: Katharon's 34 with S3 tightened (≤2 conditions per decision, MUST), plus S5 (one statement per line) and S6 (flat folders); applied by Build and the reviewer |
| Lesson skill | `template/.claude/skills/lesson/SKILL.md` | propose / approve / merge / retire / review, 12-cap |
| Subagents | `template/.claude/agents/{explorer,reviewer}.md` | Haiku sweep, Sonnet diff review, both read-only |
| Installer | `install.sh` + `lib/install.mjs` | idempotent; merges settings, appends the CLAUDE.md block between markers, detects package.json checks |

## Verification
- `npm test`: **64/64 pass** (49 hook, 15 installer). They cover the block-once and red-check gates, the every-check rule, unmasked-pass rules (quotes, `&`, `||`), parallel edits and failures, Bash-edit detection, the lessons audit, unreadable config, fail-open, install preservation and idempotence, and abort on bad settings.
- An independent review found 2 high, 2 medium and 6 low defects (lost updates under parallel calls, a red check clearing the gate, false or masked passes, installer edge cases). All are fixed. A second review found 4 more warnings (parallel failure-log writes, quote-blind command splitting, any single check clearing the gate, CRLF lessons); those are fixed with tests too.
- Installed into a scratch repo successfully.
- **Not verified live.** A headless `claude -p` run was refused (`oauth_not_allowed_for_organization`). Claude Code also ignores project `settings.json` permissions in a workspace that hasn't been trusted, so open the repo interactively once after installing.
- Hook cost: one Node start per tool call, about 50 ms in tests (not benchmarked).

- Harnestica's own code was refactored to the rulebook. A review found no behaviour change, and its 6 rule findings were fixed.

## Next
1. Install into one real project, accept the trust dialog, and confirm that the Stop gate and the failure flag fire in a live session.
2. Use it for a week, then count missed or noisy `LESSON?` proposals and the extra turns the Stop gate causes.
