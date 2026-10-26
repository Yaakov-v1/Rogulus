# Status — 2026-10-26

**The harness is now `template/CLAUDE.md` (≤100 lines). Nothing has been tried in a real project yet.**

## Decisions
- The harness is a CLAUDE.md, not a tool. The TypeScript CLI is retired to `archive/lean-sdlc-harness/`.
- Per-repo template: copy it into each project, so lessons stay project-specific.
- Claude Code is the only coding agent.

## Template
| Section | What it does |
|---|---|
| Project checks | The real check commands; the only source of *green*. |
| 1. Size the task | Tiny / small / medium / large, each with its own ritual; escalate when the work reveals more. |
| 2. Core loop | Understand → plan → build → verify → report, each step with a completion line. |
| 3. Evidence rules | Green only from checks run after the last edit; failures, timeouts and skipped checks count as unverified. |
| 4. Context budget | Targeted reads, subagents for wide sweeps, the environment over memory. |
| 5. Learning loop | `LESSON?` proposals on correction, a repeated failure or rework; owner approval; 12-lesson cap, 90-day re-review. |
| 6. Lessons | Empty slot, newest first. |

74 lines without lessons, so ≤86 when the slot is full.

## Archived CLI (0.2.0)
Brief items 1–5 are implemented. Typecheck is clean and tests pass 29/29. The benchmark's added-session p95 is 535 ms (target 2,000 ms). The real-model pilot was never run. Release archive: `releases/lean-sdlc-harness-0.2.0.tgz`.

## Not verified / next
- Whether Claude follows the template reliably (sizing, `LESSON?` proposals) is untested. Next: use it in one real project for a week and count missed or noisy lessons.
- If lesson proposals turn out unreliable, add a single tiny Stop hook as a reminder.
